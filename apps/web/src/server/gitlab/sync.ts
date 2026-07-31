import type { GitLabRunnerObservation } from "@gitlab-runner-platform/contracts";

import {
  GitLabAuthenticationError,
  GitLabRateLimitError,
  GitLabRunnerUnavailableError,
  type GitLabRunnerConnector,
} from "./client";

export type GitLabRunnerTarget = {
  runnerRecordId: string;
  runnerStackId: string;
};

export type GitLabSyncFailureReason =
  | "authentication"
  | "rate_limited"
  | "runner_unavailable"
  | "request_failed";

export interface GitLabObservationStore {
  listTargets(): Promise<GitLabRunnerTarget[]>;
  persistObservation(
    deliveryId: string,
    target: GitLabRunnerTarget,
    observation: GitLabRunnerObservation,
  ): Promise<void>;
  recordFailure(
    deliveryId: string,
    target: GitLabRunnerTarget,
    reason: GitLabSyncFailureReason,
  ): Promise<void>;
}

export type GitLabSyncResult = {
  attempted: number;
  deliveryId: string;
  failed: number;
  retryAfterSeconds: number | null;
  skipped: number;
  succeeded: number;
};

function failureReason(error: unknown): GitLabSyncFailureReason {
  if (error instanceof GitLabAuthenticationError) {
    return "authentication";
  }
  if (error instanceof GitLabRateLimitError) {
    return "rate_limited";
  }
  if (error instanceof GitLabRunnerUnavailableError) {
    return "runner_unavailable";
  }
  return "request_failed";
}

export async function syncGitLabRunnerObservations(options: {
  connector: GitLabRunnerConnector;
  deliveryId: string;
  now: Date;
  store: GitLabObservationStore;
}): Promise<GitLabSyncResult> {
  const targets = await options.store.listTargets();
  let attempted = 0;
  let failed = 0;
  let retryAfterSeconds: number | null = null;
  let succeeded = 0;

  for (const target of targets) {
    attempted += 1;
    try {
      const observation = await options.connector.observeRunner(target.runnerRecordId, options.now);
      await options.store.persistObservation(options.deliveryId, target, observation);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      const reason = failureReason(error);
      await options.store.recordFailure(options.deliveryId, target, reason);
      if (error instanceof GitLabRateLimitError) {
        retryAfterSeconds = error.retryAfterSeconds;
        break;
      }
      if (error instanceof GitLabAuthenticationError) {
        break;
      }
    }
  }

  return {
    attempted,
    deliveryId: options.deliveryId,
    failed,
    retryAfterSeconds,
    skipped: targets.length - attempted,
    succeeded,
  };
}
