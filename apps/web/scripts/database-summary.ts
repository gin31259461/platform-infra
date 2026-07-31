import { getPrismaClient } from "../src/server/database/client";

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  try {
    const [hosts, stacks, runnerRecords, credentials, observations, auditEvents] = await Promise.all([
      prisma.runnerHost.count(),
      prisma.runnerStack.count(),
      prisma.runnerRecordRef.count(),
      prisma.agentCredential.count(),
      prisma.observation.count(),
      prisma.auditEvent.count(),
    ]);
    process.stdout.write(`${JSON.stringify({
      credentials,
      auditEvents,
      hosts,
      observations,
      runnerRecords,
      stacks,
    })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write("Database summary failed\n");
  process.exitCode = 1;
});
