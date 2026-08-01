import { afterEach, describe, expect, it, vi } from "vitest";

import { startObservationRefresh } from "./observation-refresh";

afterEach(() => {
  vi.useRealTimers();
});

describe("observation refresh scheduler", () => {
  it("refreshes server-rendered observations at the configured interval", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const stop = startObservationRefresh(refresh, 10_000);

    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("rejects an interval that would aggressively reload the Control Plane", () => {
    expect(() => startObservationRefresh(() => undefined, 999)).toThrow("between 1000 and 60000");
  });
});
