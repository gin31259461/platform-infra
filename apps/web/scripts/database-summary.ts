import { getPrismaClient } from "../src/server/database/client";

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  try {
    const [
      hosts,
      stacks,
      activeStacks,
      decommissionedStacks,
      runnerRecords,
      credentials,
      observations,
      auditEvents,
      approvedProjects,
      templateRevisions,
      operations,
    ] = await Promise.all([
      prisma.runnerHost.count(),
      prisma.runnerStack.count(),
      prisma.runnerStack.count({ where: { decommissionedAt: null } }),
      prisma.runnerStack.count({ where: { decommissionedAt: { not: null } } }),
      prisma.runnerRecordRef.count(),
      prisma.agentCredential.count(),
      prisma.observation.count(),
      prisma.auditEvent.count(),
      prisma.gitLabProjectRef.count({ where: { enabled: true } }),
      prisma.runnerTemplateRevision.count({ where: { retiredAt: null } }),
      prisma.operation.count(),
    ]);
    process.stdout.write(`${JSON.stringify({
      credentials,
      auditEvents,
      approvedProjects,
      activeStacks,
      hosts,
      observations,
      operations,
      runnerRecords,
      decommissionedStacks,
      stacks,
      templateRevisions,
    })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write("Database summary failed\n");
  process.exitCode = 1;
});
