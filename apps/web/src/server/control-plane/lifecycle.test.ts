import { describe, expect, it, vi } from "vitest";

import type { GitLabSyncResult } from "../gitlab/sync";
import { runControlPlaneLifecycle, type ManagedWebProcess } from "./lifecycle";

function result(overrides: Partial<GitLabSyncResult> = {}): GitLabSyncResult {
  return {
    attempted: 2,
    deliveryId: "b08629f8-dfa8-4d2f-a720-3f593b195033",
    failed: 0,
    retryAfterSeconds: null,
    skipped: 0,
    succeeded: 2,
    ...overrides,
  };
}

function pendingWebProcess(): ManagedWebProcess & { stopped: boolean } {
  let resolveExit: ((exit: { code: number | null; signal: string | null }) => void) | undefined;
  const completion = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    resolveExit = resolve;
  });
  return {
    stopped: false,
    stop() {
      this.stopped = true;
      resolveExit?.({ code: 0, signal: "SIGTERM" });
    },
    wait: () => completion,
  };
}

describe("Control Plane lifecycle", () => {
  it("finishes startup synchronization before serving Web and delays the next sync", async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const web = pendingWebProcess();

    await runControlPlaneLifecycle({
      initialSync: async () => {
        events.push("sync");
        return result();
      },
      intervalMs: 60_000,
      onSyncResult: () => events.push("result"),
      signal: controller.signal,
      startWeb: () => {
        events.push("web");
        return web;
      },
      watch: async ({ initialDelayMs, signal }) => {
        events.push(`watch:${initialDelayMs}`);
        controller.abort();
        if (!signal.aborted) {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        }
      },
    });

    expect(events).toEqual(["sync", "result", "web", "watch:60000"]);
    expect(web.stopped).toBe(true);
  });

  it("does not serve Web when startup synchronization cannot be initialized", async () => {
    const startWeb = vi.fn(() => pendingWebProcess());

    await expect(runControlPlaneLifecycle({
      initialSync: async () => { throw new Error("credential unavailable"); },
      intervalMs: 60_000,
      onSyncResult: () => undefined,
      signal: new AbortController().signal,
      startWeb,
      watch: async () => undefined,
    })).rejects.toThrow("credential unavailable");
    expect(startWeb).not.toHaveBeenCalled();
  });

  it("stops Web when the watcher fails", async () => {
    const web = pendingWebProcess();

    await expect(runControlPlaneLifecycle({
      initialSync: async () => result({ failed: 1, succeeded: 1 }),
      intervalMs: 60_000,
      onSyncResult: () => undefined,
      signal: new AbortController().signal,
      startWeb: () => web,
      watch: async () => { throw new Error("watch failed"); },
    })).rejects.toThrow("watch failed");
    expect(web.stopped).toBe(true);
  });

  it("treats an unrequested clean Web exit as a lifecycle failure", async () => {
    const web: ManagedWebProcess = {
      stop: () => undefined,
      wait: async () => ({ code: 0, signal: null }),
    };

    await expect(runControlPlaneLifecycle({
      initialSync: async () => result(),
      intervalMs: 60_000,
      onSyncResult: () => undefined,
      signal: new AbortController().signal,
      startWeb: () => web,
      watch: async ({ signal }) => {
        if (!signal.aborted) {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        }
      },
    })).rejects.toThrow("Next.js server stopped unexpectedly");
  });
});
