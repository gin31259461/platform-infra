import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { getPrismaClient } from "../src/server/database/client";

const discoveryPath = fileURLToPath(new URL("../../../secrets/gitlab-runner-discovery.json", import.meta.url));
const discoverySchema = z.object({
  runners: z.array(z.object({
    description: z.string().max(255).nullable(),
    id: z.string().regex(/^[1-9][0-9]{0,19}$/),
    jobExecutionStatus: z.enum(["idle", "running", "unknown"]),
    paused: z.boolean().nullable(),
    projectPaths: z.array(z.string().min(3).max(255).regex(/^[^\s/]+\/[^\s/]+$/)).min(1).max(100),
    runnerType: z.literal("project_type"),
    status: z.enum(["online", "offline", "stale", "never_contacted", "unknown"]),
    workloads: z.array(z.enum(["frontend", "dotnet"])).min(1).max(2),
  }).strict()).max(100),
}).strict();

async function readDiscovery() {
  const metadata = await lstat(discoveryPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error("Discovery result must be a regular 0600 file");
  }
  if (metadata.size > 64 * 1_024) {
    throw new Error("Discovery result is too large");
  }
  return discoverySchema.parse(JSON.parse(await readFile(discoveryPath, "utf8")));
}

async function main(): Promise<void> {
  const discovery = await readDiscovery();
  const byWorkload = new Map<string, (typeof discovery.runners)[number]>();
  for (const workload of ["frontend", "dotnet"] as const) {
    const candidates = discovery.runners.filter((runner) => runner.workloads.includes(workload));
    if (candidates.length !== 1 || candidates[0].projectPaths.length !== 1) {
      throw new Error(`Discovery must identify exactly one Runner and project for ${workload}`);
    }
    byWorkload.set(workload, candidates[0]);
  }

  const displayName = z.string().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/).parse(hostname());
  const hostId = `host-${randomUUID()}`;
  const now = new Date();
  const stacks = (["frontend", "dotnet"] as const).map((workload) => {
    const runner = byWorkload.get(workload);
    if (!runner) {
      throw new Error(`Missing ${workload} discovery candidate`);
    }
    return {
      canonicalName: `gitlab-runners/${workload}`,
      id: `${workload}-main`,
      projectPath: runner.projectPaths[0],
      runnerRecordId: runner.id,
      workload,
    };
  });

  const prisma = getPrismaClient();
  try {
    await prisma.$transaction(async (transaction) => {
      const [hostCount, stackCount, runnerRecordCount] = await Promise.all([
        transaction.runnerHost.count(),
        transaction.runnerStack.count(),
        transaction.runnerRecordRef.count(),
      ]);
      if (hostCount !== 0 || stackCount !== 0 || runnerRecordCount !== 0) {
        throw new Error("Discovery import requires an empty Control Plane inventory");
      }

      await transaction.runnerHost.create({
        data: { displayName, enrolledAt: now, id: hostId },
      });
      await transaction.runnerStack.createMany({
        data: stacks.map((stack) => ({
          canonicalName: stack.canonicalName,
          hostId,
          id: stack.id,
          workload: stack.workload,
        })),
      });
      await transaction.runnerRecordRef.createMany({
        data: stacks.map((stack) => ({
          gitlabRunnerId: stack.runnerRecordId,
          id: randomUUID(),
          projectPath: stack.projectPath,
          runnerStackId: stack.id,
        })),
      });
      await transaction.auditEvent.create({
        data: {
          actorId: "bootstrap-cli",
          correlationId: randomUUID(),
          eventType: "gitlab.discovery.correlated",
          payload: { stackCount: stacks.length },
          targetId: hostId,
          targetType: "runner-host",
        },
      });
    });
  } finally {
    await prisma.$disconnect();
  }

  process.stdout.write(`${JSON.stringify({
    hostId,
    stacks: stacks.map((stack) => ({
      id: stack.id,
      runnerRecordId: stack.runnerRecordId,
      workload: stack.workload,
    })),
  })}\n`);
}

main().catch(() => {
  process.stderr.write("GitLab discovery import failed\n");
  process.exitCode = 1;
});
