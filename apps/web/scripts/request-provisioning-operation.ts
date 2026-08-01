import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getPrismaClient } from "../src/server/database/client";
import { PrismaProvisioningStore } from "../src/server/provisioning/prisma-store";
import {
  resolveProvisioningRequestAction,
  unresolvedProvisioningStates,
} from "../src/server/provisioning/request-recovery";

const optionsSchema = z.object({
  project: z.string().min(3).max(255),
  template: z.enum(["gitlab-runners/frontend", "gitlab-runners/dotnet"]),
}).strict();

function parseOptions(values: string[]): z.infer<typeof optionsSchema> {
  values = values[0] === "--" ? values.slice(1) : values;
  const options = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error("Options must use --name value pairs");
    const name = flag.slice(2);
    if (!new Set(["project", "template"]).has(name) || options.has(name)) {
      throw new Error(`Unsupported or duplicate option: ${flag}`);
    }
    options.set(name, value);
  }
  return optionsSchema.parse(Object.fromEntries(options));
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const prisma = getPrismaClient();
  try {
    const [project, revision] = await Promise.all([
      prisma.gitLabProjectRef.findFirst({ where: { enabled: true, path: options.project } }),
      prisma.runnerTemplateRevision.findFirst({
        include: { runnerTemplate: true },
        orderBy: { approvedAt: "desc" },
        where: {
          retiredAt: null,
          runnerTemplate: { canonicalName: options.template },
        },
      }),
    ]);
    if (!project || !revision) throw new Error("Project or Runner Template is not approved");
    const existing = await prisma.operation.findMany({
      orderBy: { requestedAt: "asc" },
      select: { id: true, state: true },
      where: {
        gitlabProjectRefId: project.id,
        runnerTemplateRevisionId: revision.id,
        state: { in: [...unresolvedProvisioningStates] },
      },
    });
    const action = resolveProvisioningRequestAction(existing);
    if (action.kind === "review") {
      throw new Error(`Provisioning Operation ${action.operationId} (${action.state.toLowerCase()}) requires operator review`);
    }
    if (action.kind === "resume") {
      process.stdout.write(`${JSON.stringify({
        operationId: action.operationId,
        projectPath: project.path,
        state: "authorized",
        template: revision.runnerTemplate.canonicalName,
      })}\n`);
      return;
    }

    const operation = await new PrismaProvisioningStore(prisma).requestAuthorizedOperation({
      actorId: "operator-cli",
      now: new Date(),
      request: {
        idempotencyKey: randomUUID(),
        projectRefId: project.id,
        reason: "provision one initially paused Project Runner",
        templateRevisionId: revision.id,
      },
    });
    process.stdout.write(`${JSON.stringify({
      operationId: operation.id,
      projectPath: project.path,
      state: operation.state,
      template: revision.runnerTemplate.canonicalName,
    })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Provisioning Operation request failed"}\n`);
  process.exitCode = 1;
});
