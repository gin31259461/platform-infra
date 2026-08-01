import type { FleetSnapshot } from "@gitlab-runner-platform/contracts";
import { describe, expect, it } from "vitest";

import { createRequestContext, resolveFreshnessPolicy } from "./context";
import { appRouter } from "./router";

const emptySnapshot: FleetSnapshot = {
  contractVersion: "1.0",
  generatedAt: "2026-07-31T09:00:00.000Z",
  stacks: [],
};

describe("Control Plane API", () => {
  it("rejects invalid freshness configuration", () => {
    expect(() => resolveFreshnessPolicy("29", "300")).toThrow("between 30 and 86400 seconds");
    expect(() => resolveFreshnessPolicy("90", "five-minutes")).toThrow("positive integer");
  });

  it("returns structured fleet state to a Viewer", async () => {
    const caller = appRouter.createCaller(createRequestContext({
      fleetRepository: { getSnapshot: async () => emptySnapshot },
      now: new Date(emptySnapshot.generatedAt),
    }));

    await expect(caller.fleet.list()).resolves.toMatchObject({
      generatedAt: emptySnapshot.generatedAt,
      summary: { total: 0 },
    });
  });

  it("denies fleet state when no actor is authenticated", async () => {
    const caller = appRouter.createCaller(createRequestContext({
      actor: null,
      fleetRepository: { getSnapshot: async () => emptySnapshot },
    }));
    await expect(caller.fleet.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

});
