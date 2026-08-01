import type {
  Actor,
  FleetSnapshot,
  GitLabRunnerState,
  HealthState,
  Role,
  RunnerStackObservation,
} from "@gitlab-runner-platform/contracts";

export type Permission =
  | "fleet:read"
  | "operation:request"
  | "platform:admin"
  | "audit:read";

const permissionsByRole: Record<Role, ReadonlySet<Permission>> = {
  viewer: new Set(["fleet:read"]),
  operator: new Set(["fleet:read", "operation:request"]),
  administrator: new Set(["fleet:read", "operation:request", "platform:admin", "audit:read"]),
  auditor: new Set(["audit:read"]),
};

export class AuthorizationError extends Error {
  constructor(permission: Permission) {
    super(`Actor is not authorized for ${permission}`);
    this.name = "AuthorizationError";
  }
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.roles.some((role) => permissionsByRole[role].has(permission));
}

export function authorize(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) {
    throw new AuthorizationError(permission);
  }
}

export type FreshnessPolicy = {
  gitlabMs: number;
  hostMs: number;
};

export const defaultFreshnessPolicy: FreshnessPolicy = {
  gitlabMs: 300_000,
  hostMs: 90_000,
};

export type EvaluatedRunnerStack = Omit<RunnerStackObservation, "gitlabState"> & {
  freshness: "fresh" | "stale";
  gitlabFreshness: "fresh" | "stale";
  gitlabState: GitLabRunnerState;
  state: HealthState;
};

export function evaluateRunnerStack(
  observation: RunnerStackObservation,
  now: Date,
  freshnessPolicy = defaultFreshnessPolicy,
): EvaluatedRunnerStack {
  const observedAt = observation.observedAt === null ? null : new Date(observation.observedAt);
  const freshness = observedAt === null || now.getTime() - observedAt.getTime() > freshnessPolicy.hostMs
    ? "stale"
    : "fresh";
  const gitlabObservedAt = observation.gitlabObservedAt === null
    ? null
    : new Date(observation.gitlabObservedAt);
  const gitlabFreshness = gitlabObservedAt === null
    || now.getTime() - gitlabObservedAt.getTime() > freshnessPolicy.gitlabMs
    ? "stale"
    : "fresh";
  const gitlabState = gitlabFreshness === "stale" ? "unknown" : observation.gitlabState;

  if (freshness === "stale") {
    return { ...observation, freshness, gitlabFreshness, gitlabState, state: "unknown" };
  }

  const states = observation.checks.map((check) => check.state);
  const state: HealthState = states.includes("unhealthy")
    ? "unhealthy"
    : states.includes("degraded")
      ? "degraded"
      : states.includes("unknown")
        ? "unknown"
        : "healthy";

  return { ...observation, freshness, gitlabFreshness, gitlabState, state };
}

export type FleetSummary = {
  degraded: number;
  driftFindings: number | null;
  healthy: number;
  jobsRunning: number | null;
  total: number;
  unhealthy: number;
  unknown: number;
};

export function summarizeFleet(
  snapshot: FleetSnapshot,
  now: Date,
  freshnessPolicy = defaultFreshnessPolicy,
): FleetSummary {
  const evaluated = snapshot.stacks.map((stack) => evaluateRunnerStack(stack, now, freshnessPolicy));

  return {
    degraded: evaluated.filter((stack) => stack.state === "degraded").length,
    driftFindings: evaluated.some((stack) => stack.drift === null)
      ? null
      : evaluated.reduce((count, stack) => count + (stack.drift?.length ?? 0), 0),
    healthy: evaluated.filter((stack) => stack.state === "healthy").length,
    jobsRunning: evaluated.some((stack) => stack.jobsRunning === null)
      ? null
      : evaluated.reduce((count, stack) => count + (stack.jobsRunning ?? 0), 0),
    total: evaluated.length,
    unhealthy: evaluated.filter((stack) => stack.state === "unhealthy").length,
    unknown: evaluated.filter((stack) => stack.state === "unknown").length,
  };
}
