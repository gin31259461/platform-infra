import { getEventListeners } from "node:events";

import { describe, expect, it, vi } from "vitest";

import type { GitLabSyncResult } from "./sync";
import { waitForGitLabSync, watchGitLabRunnerObservations } from "./watcher";

function result(retryAfterSeconds: number | null = null): GitLabSyncResult {
  return {
    attempted: 2,
    deliveryId: "b08629f8-dfa8-4d2f-a720-3f593b195033",
    failed: 0,
    retryAfterSeconds,
    skipped: 0,
    succeeded: 2,
  };
}

describe("GitLab observation watcher", () => {
  it("removes the abort listener after a completed delay", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const completion = waitForGitLabSync(60_000, controller.signal);

      await vi.advanceTimersByTimeAsync(60_000);
      await completion;

      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs serial synchronization until aborted", async () => {
    const controller = new AbortController();
    const sync = vi.fn(async () => {
      if (sync.mock.calls.length === 2) controller.abort();
      return result();
    });
    const onResult = vi.fn();

    await watchGitLabRunnerObservations({
      intervalMs: 60_000,
      onResult,
      signal: controller.signal,
      sync,
      wait: async () => undefined,
    });

    expect(sync).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("honors a longer rate-limit retry delay", async () => {
    const controller = new AbortController();
    const wait = vi.fn(async () => controller.abort());

    await watchGitLabRunnerObservations({
      intervalMs: 60_000,
      onResult: () => undefined,
      signal: controller.signal,
      sync: async () => result(120),
      wait,
    });

    expect(wait).toHaveBeenCalledWith(120_000, controller.signal);
  });

  it("can delay the first synchronization after a completed startup sync", async () => {
    const controller = new AbortController();
    const events: string[] = [];

    await watchGitLabRunnerObservations({
      initialDelayMs: 60_000,
      intervalMs: 60_000,
      onResult: () => undefined,
      signal: controller.signal,
      sync: async () => {
        events.push("sync");
        controller.abort();
        return result();
      },
      wait: async (delayMs) => { events.push(`wait:${delayMs}`); },
    });

    expect(events).toEqual(["wait:60000", "sync"]);
  });
});
