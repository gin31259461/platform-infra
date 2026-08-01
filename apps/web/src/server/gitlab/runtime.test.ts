import { describe, expect, it } from "vitest";

import { resolveGitLabSyncIntervalMs } from "./runtime";

describe("GitLab observation runtime", () => {
  it("accepts a bounded synchronization interval", () => {
    expect(resolveGitLabSyncIntervalMs("30")).toBe(30_000);
    expect(resolveGitLabSyncIntervalMs("3600")).toBe(3_600_000);
  });

  it("rejects invalid or unsafe synchronization intervals", () => {
    expect(() => resolveGitLabSyncIntervalMs("29")).toThrow("between 30 and 3600 seconds");
    expect(() => resolveGitLabSyncIntervalMs("3601")).toThrow("between 30 and 3600 seconds");
    expect(() => resolveGitLabSyncIntervalMs("one-minute")).toThrow("positive integer");
  });
});
