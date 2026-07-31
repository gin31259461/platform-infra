import { ZodError } from "zod";

import {
  authenticateHostAgent,
  HostAgentAuthenticationError,
  type HostAgentCredentialStore,
  type HostAgentPrincipal,
} from "@/server/agent/authentication";
import {
  HostAgentIdentityMismatchError,
  ingestHostAgentObservation,
  InvalidObservationTimeError,
  type HostAgentObservationStore,
} from "@/server/agent/ingestion";
import { PrismaHostAgentCredentialStore } from "@/server/agent/prisma-credential-store";
import {
  ConflictingObservationDeliveryError,
  PrismaHostAgentObservationStore,
  UnregisteredRunnerStackError,
} from "@/server/agent/prisma-observation-store";
import { getPrismaClient } from "@/server/database/client";

export const runtime = "nodejs";

const maximumBodyBytes = 64 * 1_024;

type ObservationHandlerDependencies = {
  authenticate(authorization: string | null, now: Date): Promise<HostAgentPrincipal>;
  now(): Date;
  observationStore: HostAgentObservationStore;
};

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export function createObservationHandler(dependencies: ObservationHandlerDependencies) {
  return async function handleObservation(request: Request): Promise<Response> {
    const now = dependencies.now();
    let principal: HostAgentPrincipal;
    try {
      principal = await dependencies.authenticate(request.headers.get("authorization"), now);
    } catch (error) {
      if (error instanceof HostAgentAuthenticationError) {
        return json(401, { error: "unauthorized" });
      }
      return json(503, { error: "observation ingestion unavailable" });
    }

    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
      return json(415, { error: "content type must be application/json" });
    }

    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes) {
      return json(413, { error: "observation exceeds 64 KiB" });
    }

    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maximumBodyBytes) {
      return json(413, { error: "observation exceeds 64 KiB" });
    }

    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return json(400, { error: "invalid JSON" });
    }

    try {
      const result = await ingestHostAgentObservation(
        principal,
        input,
        dependencies.observationStore,
        now,
      );
      return json(result.status === "accepted" ? 202 : 200, result);
    } catch (error) {
      if (error instanceof ZodError || error instanceof InvalidObservationTimeError) {
        return json(400, { error: "invalid observation" });
      }
      if (error instanceof HostAgentIdentityMismatchError || error instanceof UnregisteredRunnerStackError) {
        return json(403, { error: "observation target is not authorized" });
      }
      if (error instanceof ConflictingObservationDeliveryError) {
        return json(409, { error: "delivery ID conflicts with an existing observation" });
      }
      return json(503, { error: "observation ingestion unavailable" });
    }
  };
}

function productionDependencies(): ObservationHandlerDependencies {
  const prisma = getPrismaClient();
  const credentialStore: HostAgentCredentialStore = new PrismaHostAgentCredentialStore(prisma);
  return {
    authenticate: (authorization, now) => authenticateHostAgent(authorization, credentialStore, now),
    now: () => new Date(),
    observationStore: new PrismaHostAgentObservationStore(prisma),
  };
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.PLATFORM_OBSERVATION_INGESTION !== "enabled") {
    return json(503, { error: "observation ingestion disabled" });
  }

  try {
    return await createObservationHandler(productionDependencies())(request);
  } catch {
    return json(503, { error: "observation ingestion unavailable" });
  }
}
