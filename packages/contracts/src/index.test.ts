import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  contractVersion,
  fleetSnapshotSchema,
  gitlabRunnerObservationSchema,
  hostAgentObservationSchema,
  runnerStackObservationSchema,
} from "./index";

const validObservation = {
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
  checks: [{ key: "vpn", state: "healthy", summary: "VPN interface is available" }],
  drift: [],
};

describe("runner observation contract", () => {
  it("accepts a canonical structured observation", () => {
    expect(runnerStackObservationSchema.parse(validObservation)).toEqual(validObservation);
  });

  it("rejects arbitrary paths and unknown token fields", () => {
    expect(() => runnerStackObservationSchema.parse({
      ...validObservation,
      stackName: "../../etc/passwd",
      runnerToken: "glrt-secret",
    })).toThrow();
  });

  it("requires the explicit contract version", () => {
    expect(() => fleetSnapshotSchema.parse({
      contractVersion: "0.9",
      generatedAt: validObservation.observedAt,
      stacks: [validObservation],
    })).toThrow();

    expect(fleetSnapshotSchema.parse({
      contractVersion,
      generatedAt: validObservation.observedAt,
      stacks: [validObservation],
    }).contractVersion).toBe(contractVersion);
  });
});

describe("GitLab Runner observation contract", () => {
  const observation = JSON.parse(readFileSync(
    new URL("../fixtures/gitlab-runner-observation-v1.json", import.meta.url),
    "utf8",
  ));

  it("accepts only normalized, read-only Runner facts", () => {
    expect(gitlabRunnerObservationSchema.parse(observation)).toEqual(observation);
    expect(() => gitlabRunnerObservationSchema.parse({
      ...observation,
      token: "not-stored",
    })).toThrow();
  });

  it("keeps paused separate from GitLab connectivity status", () => {
    expect(gitlabRunnerObservationSchema.parse({
      contactedAt: null,
      contractVersion,
      jobExecutionStatus: "unknown",
      observedAt: "2026-07-31T08:59:50.000Z",
      runnerRecordId: "102",
      state: "paused",
    }).state).toBe("paused");
  });
});

const validHostAgentObservation = {
  contractVersion,
  deliveryId: "b08629f8-dfa8-4d2f-a720-3f593b195033",
  hostId: "host-01",
  observedAt: "2026-07-31T08:59:39.000Z",
  agentVersion: "0.1.0",
  stacks: [{
    id: "frontend-main",
    stackName: "gitlab-runners/frontend",
    workload: "frontend",
    runnerVersion: "17.11.1",
    tags: ["frontend", "podman"],
    jobsRunning: 1,
    checks: [{ key: "vpn", state: "healthy", summary: "VPN interface is available" }],
    drift: [],
  }],
};

describe("Host Agent observation contract", () => {
  it("accepts the executable Agent fixture", () => {
    const fixture = JSON.parse(readFileSync(
      new URL("../fixtures/host-agent-observation-v1.json", import.meta.url),
      "utf8",
    ));
    expect(hostAgentObservationSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts host facts without GitLab-owned fields", () => {
    expect(hostAgentObservationSchema.parse(validHostAgentObservation)).toEqual(validHostAgentObservation);
  });

  it("rejects GitLab-owned fields and duplicate Stack identities", () => {
    expect(() => hostAgentObservationSchema.parse({
      ...validHostAgentObservation,
      stacks: [
        { ...validHostAgentObservation.stacks[0], gitlabState: "online" },
        validHostAgentObservation.stacks[0],
      ],
    })).toThrow();
  });

  it("rejects token-shaped diagnostic text", () => {
    expect(() => hostAgentObservationSchema.parse({
      ...validHostAgentObservation,
      stacks: [{
        ...validHostAgentObservation.stacks[0],
        checks: [{ key: "runner-config", state: "unhealthy", summary: ["Found glrt", "secret-value"].join("-") }],
      }],
    })).toThrow("token-shaped");
  });
});
