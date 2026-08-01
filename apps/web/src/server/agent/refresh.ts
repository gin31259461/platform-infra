export const hostObservationRefreshReasons = [
  "current",
  "missing",
  "stale",
  "startup",
] as const;

export type HostObservationRefreshReason = typeof hostObservationRefreshReasons[number];

export type HostObservationRefreshDecision = {
  reason: HostObservationRefreshReason;
  refresh: boolean;
};

export function resolveHostObservationForceAfter(
  setting = process.env.PLATFORM_FORCE_HOST_REFRESH_ON_START,
  startedAt = process.env.PLATFORM_CONTROL_PLANE_STARTED_AT,
): Date | null {
  if (setting === "disabled") return null;
  if (setting !== undefined && setting !== "enabled") {
    throw new Error("PLATFORM_FORCE_HOST_REFRESH_ON_START must be enabled or disabled");
  }
  if (startedAt === undefined) {
    throw new Error("Control Plane start time is unavailable");
  }
  const value = new Date(startedAt);
  if (Number.isNaN(value.getTime())) {
    throw new Error("Control Plane start time is invalid");
  }
  return value;
}

type HostObservationRefreshInput = {
  forceAfter: Date | null;
  latestObservedAt: Date | null;
  now: Date;
  staleAfterMs: number;
};

export function decideHostObservationRefresh(
  input: HostObservationRefreshInput,
): HostObservationRefreshDecision {
  if (input.latestObservedAt === null) {
    return { reason: "missing", refresh: true };
  }
  if (input.forceAfter !== null && input.latestObservedAt < input.forceAfter) {
    return { reason: "startup", refresh: true };
  }
  if (input.now.getTime() - input.latestObservedAt.getTime() >= input.staleAfterMs) {
    return { reason: "stale", refresh: true };
  }
  return { reason: "current", refresh: false };
}
