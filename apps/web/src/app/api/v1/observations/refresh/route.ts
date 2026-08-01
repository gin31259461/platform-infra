import {
  authenticateHostAgent,
  HostAgentAuthenticationError,
  type HostAgentCredentialStore,
  type HostAgentPrincipal,
} from "@/server/agent/authentication";
import { PrismaHostAgentCredentialStore } from "@/server/agent/prisma-credential-store";
import {
  decideHostObservationRefresh,
  resolveHostObservationForceAfter,
} from "@/server/agent/refresh";
import { resolveFreshnessPolicy } from "@/server/api/context";
import { getPrismaClient } from "@/server/database/client";
import { ObservationSource } from "../../../../../../generated/prisma/client";

export const runtime = "nodejs";

type ObservationRefreshHandlerDependencies = {
  authenticate(authorization: string | null, now: Date): Promise<HostAgentPrincipal>;
  forceAfter: Date | null;
  latestObservedAt(runnerStackId: string): Promise<Date | null>;
  now(): Date;
  staleAfterMs: number;
};

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export function createObservationRefreshHandler(
  dependencies: ObservationRefreshHandlerDependencies,
) {
  return async function handleObservationRefresh(request: Request): Promise<Response> {
    const now = dependencies.now();
    let principal: HostAgentPrincipal;
    try {
      principal = await dependencies.authenticate(request.headers.get("authorization"), now);
    } catch (error) {
      if (error instanceof HostAgentAuthenticationError) {
        return json(401, { error: "unauthorized" });
      }
      return json(503, { error: "observation refresh unavailable" });
    }

    try {
      const latestObservedAt = await dependencies.latestObservedAt(principal.runnerStackId);
      return json(200, {
        contractVersion: "1.0",
        ...decideHostObservationRefresh({
          forceAfter: dependencies.forceAfter,
          latestObservedAt,
          now,
          staleAfterMs: dependencies.staleAfterMs,
        }),
      });
    } catch {
      return json(503, { error: "observation refresh unavailable" });
    }
  };
}

function productionDependencies(): ObservationRefreshHandlerDependencies {
  const prisma = getPrismaClient();
  const credentialStore: HostAgentCredentialStore = new PrismaHostAgentCredentialStore(prisma);
  return {
    authenticate: (authorization, now) => authenticateHostAgent(authorization, credentialStore, now),
    forceAfter: resolveHostObservationForceAfter(),
    latestObservedAt: async (runnerStackId) => {
      const latest = await prisma.observation.findFirst({
        orderBy: { observedAt: "desc" },
        select: { observedAt: true },
        where: { runnerStackId, source: ObservationSource.HOST_AGENT },
      });
      return latest?.observedAt ?? null;
    },
    now: () => new Date(),
    staleAfterMs: resolveFreshnessPolicy().hostMs,
  };
}

export async function GET(request: Request): Promise<Response> {
  if (process.env.PLATFORM_OBSERVATION_INGESTION !== "enabled") {
    return json(503, { error: "observation ingestion disabled" });
  }

  try {
    return await createObservationRefreshHandler(productionDependencies())(request);
  } catch {
    return json(503, { error: "observation refresh unavailable" });
  }
}
