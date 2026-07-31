import { contractVersion, type HostAgentObservation } from "@gitlab-runner-platform/contracts";
import { describe, expect, it, vi } from "vitest";

import { HostAgentAuthenticationError } from "@/server/agent/authentication";
import { ConflictingObservationDeliveryError } from "@/server/agent/prisma-observation-store";

import { createObservationHandler, POST } from "./route";

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

function request(body: string, authorization = "Bearer valid"): Request {
  return new Request("http://localhost/api/v1/observations", {
    body,
    headers: { authorization, "content-type": "application/json" },
    method: "POST",
  });
}

function dependencies(status: "accepted" | "duplicate" = "accepted") {
  return {
    authenticate: vi.fn(async () => ({
      credentialId: "hac_abcdefghijklmnop",
      hostId: "host-01",
      runnerStackId: "frontend-main",
    })),
    now: () => new Date("2026-07-31T09:00:00.000Z"),
    observationStore: {
      persist: vi.fn(async () => ({
        acceptedStacks: status === "accepted" ? 1 : 0,
        deliveryId: observation.deliveryId,
        status,
      })),
    },
  };
}

describe("POST /api/v1/observations", () => {
  it("is disabled by default", async () => {
    const previous = process.env.PLATFORM_OBSERVATION_INGESTION;
    delete process.env.PLATFORM_OBSERVATION_INGESTION;
    try {
      const response = await POST(request(JSON.stringify(observation)));
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "observation ingestion disabled" });
    } finally {
      if (previous === undefined) delete process.env.PLATFORM_OBSERVATION_INGESTION;
      else process.env.PLATFORM_OBSERVATION_INGESTION = previous;
    }
  });

  it("accepts a valid authenticated delivery", async () => {
    const response = await createObservationHandler(dependencies())(request(JSON.stringify(observation)));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ status: "accepted", acceptedStacks: 1 });
  });

  it("acknowledges a duplicate delivery without inserting it again", async () => {
    const response = await createObservationHandler(dependencies("duplicate"))(request(JSON.stringify(observation)));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "duplicate", acceptedStacks: 0 });
  });

  it("rejects a delivery ID reused with different content", async () => {
    const conflicting = dependencies();
    conflicting.observationStore.persist.mockRejectedValue(new ConflictingObservationDeliveryError());
    const response = await createObservationHandler(conflicting)(request(JSON.stringify(observation)));
    expect(response.status).toBe(409);
  });

  it("fails closed without revealing credential details", async () => {
    const dependenciesWithDenial = dependencies();
    dependenciesWithDenial.authenticate.mockRejectedValue(new HostAgentAuthenticationError());
    const response = await createObservationHandler(dependenciesWithDenial)(request(JSON.stringify(observation), "Bearer invalid"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("rejects invalid and oversized request bodies", async () => {
    const handler = createObservationHandler(dependencies());
    expect((await handler(request("not-json"))).status).toBe(400);
    expect((await handler(request("x".repeat(64 * 1_024 + 1)))).status).toBe(413);
  });
});
