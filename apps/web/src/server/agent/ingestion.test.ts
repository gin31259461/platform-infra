import { contractVersion, type HostAgentObservation } from "@gitlab-runner-platform/contracts";
import { describe, expect, it, vi } from "vitest";

import { ingestHostAgentObservation } from "./ingestion";

const now = new Date("2026-07-31T09:00:00.000Z");
const principal = {
  credentialId: "hac_abcdefghijklmnop",
  hostId: "host-01",
  runnerStackId: "frontend-main",
};
const observation: HostAgentObservation = {
  agentVersion: "0.1.0",
  contractVersion,
  deliveryId: "b08629f8-dfa8-4d2f-a720-3f593b195033",
  hostId: "host-01",
  observedAt: "2026-07-31T08:59:39.000Z",
  stacks: [{
    checks: [{ key: "vpn", state: "healthy", summary: "VPN interface is available" }],
    drift: [],
    id: "frontend-main",
    jobsRunning: 0,
    runnerVersion: "17.11.1",
    stackName: "gitlab-runners/frontend",
    tags: ["frontend", "podman"],
    workload: "frontend",
  }],
};

describe("Host Agent observation ingestion", () => {
  it("persists a contract-valid observation for the authenticated Host", async () => {
    const persist = vi.fn(async () => ({
      acceptedStacks: 1,
      deliveryId: observation.deliveryId,
      status: "accepted" as const,
    }));

    await expect(ingestHostAgentObservation(principal, observation, { persist }, now)).resolves.toMatchObject({
      status: "accepted",
    });
    expect(persist).toHaveBeenCalledWith(principal, observation);
  });

  it("rejects a credential attempting to report for another Host", async () => {
    const persist = vi.fn();
    await expect(ingestHostAgentObservation(
      principal,
      { ...observation, hostId: "host-02" },
      { persist },
      now,
    )).rejects.toThrow("not authorized");
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects a credential attempting to report another Runner Stack", async () => {
    const persist = vi.fn();
    await expect(ingestHostAgentObservation(
      principal,
      {
        ...observation,
        stacks: [{ ...observation.stacks[0], id: "dotnet-main" }],
      },
      { persist },
      now,
    )).rejects.toThrow("not authorized");
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects timestamps beyond the bounded clock skew", async () => {
    await expect(ingestHostAgentObservation(
      principal,
      { ...observation, observedAt: "2026-07-31T09:05:01.000Z" },
      { persist: vi.fn() },
      now,
    )).rejects.toThrow("too far in the future");
  });
});
