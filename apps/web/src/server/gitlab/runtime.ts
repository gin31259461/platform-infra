import { randomUUID } from "node:crypto";

import { getPrismaClient } from "../database/client";
import { GraphQlGitLabRunnerConnector } from "./client";
import { loadGitLabCredential } from "./credential-store";
import { PrismaGitLabObservationStore } from "./prisma-store";
import { syncGitLabRunnerObservations, type GitLabSyncResult } from "./sync";

export type GitLabObservationRuntime = {
  disconnect(): Promise<void>;
  sync(): Promise<GitLabSyncResult>;
};

export function resolveGitLabSyncIntervalMs(
  value = process.env.GITLAB_SYNC_INTERVAL_SECONDS ?? "60",
): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error("GITLAB_SYNC_INTERVAL_SECONDS must be a positive integer");
  }
  const milliseconds = Number(value) * 1_000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 30_000 || milliseconds > 3_600_000) {
    throw new Error("GITLAB_SYNC_INTERVAL_SECONDS must be between 30 and 3600 seconds");
  }
  return milliseconds;
}

export async function createGitLabObservationRuntime(): Promise<GitLabObservationRuntime> {
  const baseUrl = process.env.GITLAB_BASE_URL;
  if (!baseUrl) throw new Error("GITLAB_BASE_URL is required");

  const token = await loadGitLabCredential("monitoring");
  const prisma = getPrismaClient();
  const connector = new GraphQlGitLabRunnerConnector({ baseUrl, token });
  const store = new PrismaGitLabObservationStore(prisma);

  return {
    disconnect: () => prisma.$disconnect(),
    sync: () => syncGitLabRunnerObservations({
      connector,
      deliveryId: randomUUID(),
      now: new Date(),
      store,
    }),
  };
}
