import type { Actor } from "@gitlab-runner-platform/contracts";

import { FakeFleetRepository } from "../fleet/fake-repository";
import { PrismaFleetRepository } from "../fleet/prisma-repository";
import type { FleetRepository } from "../fleet/repository";
import { getPrismaClient } from "../database/client";

export type RequestContext = {
  actor: Actor | null;
  fleetRepository: FleetRepository;
  now: Date;
};

const developmentActor: Actor = {
  id: "development-viewer",
  displayName: "Local Viewer",
  roles: ["viewer"],
};

export function resolveDevelopmentActor(
  nodeEnvironment = process.env.NODE_ENV,
  authMode = process.env.PLATFORM_AUTH_MODE ?? "development-stub",
): Actor {
  if (authMode !== "development-stub") {
    throw new Error(`Unsupported authentication mode: ${authMode}`);
  }
  if (nodeEnvironment === "production") {
    throw new Error("Production authentication is not configured; development stub denied");
  }
  return developmentActor;
}

export function createRequestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    actor: resolveDevelopmentActor(),
    fleetRepository: createFleetRepository(),
    now: new Date(),
    ...overrides,
  };
}

export function createFleetRepository(
  mode = process.env.PLATFORM_FLEET_REPOSITORY ?? "fake",
): FleetRepository {
  if (mode === "fake") return new FakeFleetRepository();
  if (mode === "postgresql") return new PrismaFleetRepository(getPrismaClient());
  throw new Error(`Unsupported Fleet repository mode: ${mode}`);
}
