import type { Actor, RunnerStackObservation } from "@gitlab-runner-platform/contracts";
import { describe, expect, it } from "vitest";

import {
  AuthorizationError,
  authorize,
  can,
  evaluateRunnerStack,
  summarizeFleet,
} from "./index";

const viewer: Actor = { id: "viewer-1", displayName: "Local Viewer", roles: ["viewer"] };

const observation: RunnerStackObservation = {
  id: "frontend-main",
  stackName: "gitlab-runners/frontend",
  workload: "frontend",
  hostId: "host-01",
  hostDisplayName: "runner-arch-01",
  projectPath: "shop/web-store",
  runnerRecordId: "101",
  gitlabState: "online",
  gitlabContactedAt: "2026-07-31T08:59:48.000Z",
  gitlabJobExecutionStatus: "running",
  gitlabObservedAt: "2026-07-31T08:59:50.000Z",
  observedAt: "2026-07-31T08:59:39.000Z",
  runnerVersion: "17.11.1",
  tags: ["frontend", "podman"],
  jobsRunning: 1,
  checks: [
    { key: "vpn", state: "healthy", summary: "VPN interface is available" },
    { key: "dns", state: "healthy", summary: "GitLab hostname resolves" },
  ],
  drift: [],
};

describe("authorization", () => {
  it("allows a viewer to read fleet state but not request operations", () => {
    expect(can(viewer, "fleet:read")).toBe(true);
    expect(can(viewer, "operation:request")).toBe(false);
    expect(() => authorize(viewer, "operation:request")).toThrow(AuthorizationError);
  });
});

describe("Runner Stack health", () => {
  it("derives health from structured checks", () => {
    expect(evaluateRunnerStack(observation, new Date("2026-07-31T09:00:00.000Z"))).toMatchObject({
      freshness: "fresh",
      gitlabFreshness: "fresh",
      state: "healthy",
    });

    expect(evaluateRunnerStack({
      ...observation,
      checks: [{ key: "dns", state: "unhealthy", summary: "GitLab hostname is unresolved" }],
    }, new Date("2026-07-31T09:00:00.000Z"))).toMatchObject({ state: "unhealthy" });
  });

  it("never reports a stale GitLab observation as current", () => {
    expect(evaluateRunnerStack({
      ...observation,
      gitlabObservedAt: "2026-07-31T08:58:00.000Z",
    }, new Date("2026-07-31T09:00:00.000Z"))).toMatchObject({
      gitlabFreshness: "stale",
      gitlabState: "unknown",
      state: "healthy",
    });
  });

  it("never reports a stale observation as healthy", () => {
    expect(evaluateRunnerStack(observation, new Date("2026-07-31T09:02:00.000Z"))).toMatchObject({
      freshness: "stale",
      state: "unknown",
    });
  });

  it("does not turn unknown job and Drift evidence into zero", () => {
    expect(summarizeFleet({
      contractVersion: "1.0",
      generatedAt: "2026-07-31T09:00:00.000Z",
      stacks: [{ ...observation, drift: null, jobsRunning: null }],
    }, new Date("2026-07-31T09:00:00.000Z"))).toMatchObject({
      driftFindings: null,
      jobsRunning: null,
    });
  });
});
