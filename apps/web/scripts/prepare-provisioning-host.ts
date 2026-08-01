import { z } from "zod";

import { OperationState } from "../generated/prisma/client";
import { getPrismaClient } from "../src/server/database/client";
import { deriveProvisionedRunnerInstance } from "../src/server/provisioning/instance";
import { materializeProvisionedStack } from "../src/server/provisioning/stack-materializer";


function parseOperationId(values: string[]): string {
  values = values[0] === "--" ? values.slice(1) : values;
  if (values.length !== 2 || values[0] !== "--operation-id") {
    throw new Error("Usage: --operation-id <uuid>");
  }
  return z.uuid().parse(values[1]);
}

async function main(): Promise<void> {
  const operationId = parseOperationId(process.argv.slice(2));
  const prisma = getPrismaClient();
  try {
    const operation = await prisma.operation.findUnique({
      include: {
        gitlabProjectRef: true,
        runnerTemplateRevision: { include: { runnerTemplate: true } },
      },
      where: { id: operationId },
    });
    if (
      !operation
      || operation.state !== OperationState.AUTHORIZED
      || !operation.gitlabProjectRef.enabled
      || operation.runnerTemplateRevision.retiredAt !== null
    ) {
      throw new Error("Provisioning Operation is not authorized and ready for Host preparation");
    }
    const hosts = await prisma.runnerHost.findMany({
      select: { id: true },
      take: 2,
      where: { revokedAt: null },
    });
    if (hosts.length !== 1) throw new Error("Provisioning requires exactly one active Runner Host");
    const instance = deriveProvisionedRunnerInstance({
      canonicalName: operation.runnerTemplateRevision.runnerTemplate.canonicalName,
      operationId: operation.id,
      workload: operation.runnerTemplateRevision.runnerTemplate.workload,
    });
    const existing = await prisma.runnerStack.findUnique({ where: { id: instance.stackId } });
    if (existing) throw new Error("Provisioned Runner Stack identity already exists");
    await materializeProvisionedStack(instance);
    process.stdout.write(`${JSON.stringify({
      hostId: hosts[0]!.id,
      operationId,
      projectPath: operation.gitlabProjectRef.path,
      stackId: instance.stackId,
      template: instance.canonicalName,
    })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Host preparation staging failed"}\n`);
  process.exitCode = 1;
});
