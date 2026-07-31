import { randomUUID } from "node:crypto";

import { getPrismaClient } from "../src/server/database/client";
import { GraphQlGitLabRunnerConnector } from "../src/server/gitlab/client";
import { PrismaGitLabObservationStore } from "../src/server/gitlab/prisma-store";
import { syncGitLabRunnerObservations } from "../src/server/gitlab/sync";
import { readSecretFromStandardInput } from "./lib/secret-input";

async function main(): Promise<void> {
  const baseUrl = process.env.GITLAB_BASE_URL;
  if (!baseUrl) {
    throw new Error("GITLAB_BASE_URL is required");
  }

  const token = await readSecretFromStandardInput("GitLab token");
  const prisma = getPrismaClient();
  try {
    const result = await syncGitLabRunnerObservations({
      connector: new GraphQlGitLabRunnerConnector({ baseUrl, token }),
      deliveryId: randomUUID(),
      now: new Date(),
      store: new PrismaGitLabObservationStore(prisma),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write("GitLab Runner synchronization failed\n");
  process.exitCode = 1;
});
