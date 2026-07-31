import type { GitLabRunnerObservation } from "@gitlab-runner-platform/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  GitLabAuthenticationError,
  GitLabRateLimitError,
  GitLabRunnerUnavailableError,
  type GitLabRunnerConnector,
} from "./client";
import { syncGitLabRunnerObservations, type GitLabObservationStore } from "./sync";

const targets = [
  { runnerRecordId: "101", runnerStackId: "frontend-main" },
  { runnerRecordId: "102", runnerStackId: "dotnet-orders" },
  { runnerRecordId: "103", runnerStackId: "frontend-admin" },
];
const observation = (runnerRecordId: string): GitLabRunnerObservation => ({
  contactedAt: null,
  contractVersion: "1.0",
  jobExecutionStatus: "idle",
  observedAt: "2026-07-31T09:00:00.000Z",
  runnerRecordId,
  state: "online",
});

function store(): GitLabObservationStore {
  return {
    listTargets: vi.fn(async () => targets),
    persistObservation: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
  };
}

describe("GitLab Runner synchronization", () => {
  it("persists each successful Runner observation independently", async () => {
    const observationStore = store();
    const connector: GitLabRunnerConnector = {
      observeRunner: vi.fn(async (runnerRecordId) => observation(runnerRecordId)),
    };

    await expect(syncGitLabRunnerObservations({
      connector,
      deliveryId: "d3fdd53d-11cf-4f87-812c-1ff3787a1e99",
      now: new Date("2026-07-31T09:00:00.000Z"),
      store: observationStore,
    })).resolves.toEqual({
      attempted: 3,
      deliveryId: "d3fdd53d-11cf-4f87-812c-1ff3787a1e99",
      failed: 0,
      retryAfterSeconds: null,
      skipped: 0,
      succeeded: 3,
    });
    expect(observationStore.persistObservation).toHaveBeenCalledTimes(3);
  });

  it("keeps syncing after a Runner-specific visibility failure", async () => {
    const observationStore = store();
    const connector: GitLabRunnerConnector = {
      observeRunner: vi.fn(async (runnerRecordId) => {
        if (runnerRecordId === "102") {
          throw new GitLabRunnerUnavailableError();
        }
        return observation(runnerRecordId);
      }),
    };

    const result = await syncGitLabRunnerObservations({
      connector,
      deliveryId: "d3fdd53d-11cf-4f87-812c-1ff3787a1e99",
      now: new Date("2026-07-31T09:00:00.000Z"),
      store: observationStore,
    });
    expect(result).toMatchObject({ attempted: 3, failed: 1, skipped: 0, succeeded: 2 });
    expect(observationStore.recordFailure).toHaveBeenCalledWith(
      expect.any(String),
      targets[1],
      "runner_unavailable",
    );
  });

  it.each([
    [new GitLabAuthenticationError(), "authentication", null],
    [new GitLabRateLimitError(90), "rate_limited", 90],
  ] as const)("stops after a connector-wide failure", async (failure, reason, retryAfterSeconds) => {
    const observationStore = store();
    const connector: GitLabRunnerConnector = {
      observeRunner: vi.fn(async () => { throw failure; }),
    };

    const result = await syncGitLabRunnerObservations({
      connector,
      deliveryId: "d3fdd53d-11cf-4f87-812c-1ff3787a1e99",
      now: new Date("2026-07-31T09:00:00.000Z"),
      store: observationStore,
    });
    expect(result).toMatchObject({
      attempted: 1,
      failed: 1,
      retryAfterSeconds,
      skipped: 2,
      succeeded: 0,
    });
    expect(observationStore.recordFailure).toHaveBeenCalledWith(expect.any(String), targets[0], reason);
  });
});
