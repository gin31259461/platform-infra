import type { FleetSnapshot } from "@gitlab-runner-platform/contracts";
import { describe, expect, it } from "vitest";

import { createRequestContext, resolveDevelopmentActor } from "./context";
import { appRouter } from "./router";

const emptySnapshot: FleetSnapshot = {
  contractVersion: "1.0",
  generatedAt: "2026-07-31T09:00:00.000Z",
  stacks: [],
};

describe("Control Plane API", () => {
  it("fails closed when the development identity reaches production", () => {
    expect(() => resolveDevelopmentActor("production", "development-stub")).toThrow(
      "Production authentication is not configured",
    );
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
    const caller = appRouter.createCaller(createRequestContext({ actor: null }));
    await expect(caller.fleet.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
