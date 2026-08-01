import { describe, expect, it } from "vitest";

import {
  decideHostObservationRefresh,
  resolveHostObservationForceAfter,
} from "./refresh";

const now = new Date("2026-08-01T09:00:00.000Z");
const staleAfterMs = 90_000;

describe("Host observation refresh policy", () => {
  it("requests a missing observation", () => {
    expect(decideHostObservationRefresh({
      forceAfter: null,
      latestObservedAt: null,
      now,
      staleAfterMs,
    })).toEqual({ reason: "missing", refresh: true });
  });

  it("waits while the latest observation is fresh", () => {
    expect(decideHostObservationRefresh({
      forceAfter: null,
      latestObservedAt: new Date("2026-08-01T08:59:00.001Z"),
      now,
      staleAfterMs,
    })).toEqual({ reason: "current", refresh: false });
  });

  it("requests an observation at the stale boundary", () => {
    expect(decideHostObservationRefresh({
      forceAfter: null,
      latestObservedAt: new Date("2026-08-01T08:58:30.000Z"),
      now,
      staleAfterMs,
    })).toEqual({ reason: "stale", refresh: true });
  });

  it("forces one observation after the current Control Plane start", () => {
    expect(decideHostObservationRefresh({
      forceAfter: new Date("2026-08-01T08:59:50.000Z"),
      latestObservedAt: new Date("2026-08-01T08:59:49.999Z"),
      now,
      staleAfterMs,
    })).toEqual({ reason: "startup", refresh: true });

    expect(decideHostObservationRefresh({
      forceAfter: new Date("2026-08-01T08:59:50.000Z"),
      latestObservedAt: new Date("2026-08-01T08:59:50.000Z"),
      now,
      staleAfterMs,
    })).toEqual({ reason: "current", refresh: false });
  });

  it("forces on startup by default and supports an explicit opt-out", () => {
    expect(resolveHostObservationForceAfter(
      undefined,
      "2026-08-01T08:59:50.000Z",
    )).toEqual(new Date("2026-08-01T08:59:50.000Z"));
    expect(resolveHostObservationForceAfter("disabled", undefined)).toBeNull();
    expect(resolveHostObservationForceAfter(
      "enabled",
      "2026-08-01T08:59:50.000Z",
    )).toEqual(new Date("2026-08-01T08:59:50.000Z"));
    expect(() => resolveHostObservationForceAfter("yes", undefined)).toThrow("enabled or disabled");
    expect(() => resolveHostObservationForceAfter(undefined, undefined)).toThrow("unavailable");
  });
});
