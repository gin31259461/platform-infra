import type { Actor } from "@gitlab-runner-platform/contracts";
import { defaultFreshnessPolicy, type FreshnessPolicy } from "@gitlab-runner-platform/domain";

import { PrismaFleetRepository } from "../fleet/prisma-repository";
import type { FleetRepository } from "../fleet/repository";
import { getPrismaClient } from "../database/client";

export type RequestContext = {
  actor: Actor | null;
  fleetRepository: FleetRepository;
  freshnessPolicy: FreshnessPolicy;
  now: Date;
};

const internalNetworkViewer: Actor = {
  id: "internal-network-viewer",
  displayName: "Internal network",
  roles: ["viewer"],
};

export function createRequestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    actor: internalNetworkViewer,
    fleetRepository: overrides.fleetRepository ?? createFleetRepository(),
    freshnessPolicy: resolveFreshnessPolicy(),
    now: new Date(),
    ...overrides,
  };
}

function parseFreshnessSeconds(value: string | undefined, fallbackMs: number, name: string): number {
  if (value === undefined) return fallbackMs;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const milliseconds = Number(value) * 1_000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 30_000 || milliseconds > 86_400_000) {
    throw new Error(`${name} must be between 30 and 86400 seconds`);
  }
  return milliseconds;
}

export function resolveFreshnessPolicy(
  hostSeconds = process.env.PLATFORM_HOST_FRESHNESS_SECONDS,
  gitlabSeconds = process.env.PLATFORM_GITLAB_FRESHNESS_SECONDS,
): FreshnessPolicy {
  return {
    gitlabMs: parseFreshnessSeconds(
      gitlabSeconds,
      defaultFreshnessPolicy.gitlabMs,
      "PLATFORM_GITLAB_FRESHNESS_SECONDS",
    ),
    hostMs: parseFreshnessSeconds(
      hostSeconds,
      defaultFreshnessPolicy.hostMs,
      "PLATFORM_HOST_FRESHNESS_SECONDS",
    ),
  };
}

export function createFleetRepository(): FleetRepository {
  return new PrismaFleetRepository(getPrismaClient());
}
