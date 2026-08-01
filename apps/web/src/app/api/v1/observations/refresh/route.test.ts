import { describe, expect, it, vi } from "vitest";

import { HostAgentAuthenticationError } from "@/server/agent/authentication";

import { createObservationRefreshHandler, GET } from "./route";

function request(authorization = "Bearer valid"): Request {
  return new Request("http://localhost/api/v1/observations/refresh", {
    headers: { authorization },
    method: "GET",
  });
}

function dependencies(latestObservedAt: Date | null) {
  return {
    authenticate: vi.fn(async () => ({
      credentialId: "hac_abcdefghijklmnop",
      hostId: "host-01",
      runnerStackId: "frontend-main",
    })),
    forceAfter: null,
    latestObservedAt: vi.fn(async () => latestObservedAt),
    now: () => new Date("2026-08-01T09:00:00.000Z"),
    staleAfterMs: 90_000,
  };
}

describe("GET /api/v1/observations/refresh", () => {
  it("is disabled with observation ingestion by default", async () => {
    const previous = process.env.PLATFORM_OBSERVATION_INGESTION;
    delete process.env.PLATFORM_OBSERVATION_INGESTION;
    try {
      const response = await GET(request());
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "observation ingestion disabled" });
    } finally {
      if (previous === undefined) delete process.env.PLATFORM_OBSERVATION_INGESTION;
      else process.env.PLATFORM_OBSERVATION_INGESTION = previous;
    }
  });

  it("returns a bounded stale-by-default decision for the authenticated stack", async () => {
    const values = dependencies(new Date("2026-08-01T08:59:00.001Z"));
    const response = await createObservationRefreshHandler(values)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      contractVersion: "1.0",
      reason: "current",
      refresh: false,
    });
    expect(values.latestObservedAt).toHaveBeenCalledWith("frontend-main");
  });

  it("requests a fresh observation once after startup when enabled", async () => {
    const values = {
      ...dependencies(new Date("2026-08-01T08:59:49.999Z")),
      forceAfter: new Date("2026-08-01T08:59:50.000Z"),
    };
    const response = await createObservationRefreshHandler(values)(request());

    await expect(response.json()).resolves.toEqual({
      contractVersion: "1.0",
      reason: "startup",
      refresh: true,
    });
  });

  it("authenticates before reading observation state", async () => {
    const values = dependencies(null);
    values.authenticate.mockRejectedValue(new HostAgentAuthenticationError());
    const response = await createObservationRefreshHandler(values)(request("Bearer invalid"));

    expect(response.status).toBe(401);
    expect(values.latestObservedAt).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });
});
