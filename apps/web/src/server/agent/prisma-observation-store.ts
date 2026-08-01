import type {
  HostAgentObservation,
  HostAgentStackObservation,
} from "@gitlab-runner-platform/contracts";
import { createHash } from "node:crypto";

import {
  ObservationSource,
  Prisma,
  type PrismaClient,
} from "../../../generated/prisma/client";
import type { HostAgentPrincipal } from "./authentication";
import type {
  HostAgentObservationStore,
  ObservationIngestionResult,
} from "./ingestion";

type RegisteredStack = { canonicalName: string; id: string; workload: string };

export class UnregisteredRunnerStackError extends Error {
  constructor() {
    super("Observation contains an unregistered or mismatched Runner Stack");
    this.name = "UnregisteredRunnerStackError";
  }
}

export class ConflictingObservationDeliveryError extends Error {
  constructor() {
    super("Delivery ID was already used with different observation content");
    this.name = "ConflictingObservationDeliveryError";
  }
}

export class PrismaHostAgentObservationStore implements HostAgentObservationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async persist(
    principal: HostAgentPrincipal,
    observation: HostAgentObservation,
  ): Promise<ObservationIngestionResult> {
    if (
      observation.hostId !== principal.hostId
      || observation.stacks.length !== 1
      || observation.stacks[0]?.id !== principal.runnerStackId
    ) {
      throw new UnregisteredRunnerStackError();
    }

    return this.prisma.$transaction(async (transaction) => {
      const deliveryDigest = createHash("sha256")
        .update(JSON.stringify(observation), "utf8")
        .digest("hex");
      const registeredStacks = await transaction.runnerStack.findMany({
        select: { canonicalName: true, id: true, workload: true },
        where: {
          hostId: principal.hostId,
          id: { in: observation.stacks.map((stack: HostAgentStackObservation) => stack.id) },
        },
      });
      const registeredById = new Map(registeredStacks.map((stack: RegisteredStack) => [stack.id, stack]));
      const allStacksMatch = observation.stacks.every((stack: HostAgentStackObservation) => {
        const registered = registeredById.get(stack.id);
        return registered
          && registered.canonicalName === stack.stackName
          && registered.workload === stack.workload;
      });
      if (!allStacksMatch || registeredStacks.length !== observation.stacks.length) {
        throw new UnregisteredRunnerStackError();
      }

      const inserted = await transaction.observation.createMany({
        data: observation.stacks.map((stack: HostAgentStackObservation) => ({
          deliveryId: observation.deliveryId,
          deliveryDigest,
          observedAt: new Date(observation.observedAt),
          payload: stack as unknown as Prisma.InputJsonValue,
          runnerStackId: stack.id,
          schemaVersion: observation.contractVersion,
          source: ObservationSource.HOST_AGENT,
        })),
        skipDuplicates: true,
      });

      if (inserted.count !== 0 && inserted.count !== observation.stacks.length) {
        throw new Error("Observation delivery was only partially persisted");
      }

      if (inserted.count === 0) {
        const existing = await transaction.observation.findMany({
          select: { deliveryDigest: true },
          where: {
            deliveryId: observation.deliveryId,
            runnerStackId: {
              in: observation.stacks.map((stack: HostAgentStackObservation) => stack.id),
            },
            source: ObservationSource.HOST_AGENT,
          },
        });
        if (
          existing.length !== observation.stacks.length
          || existing.some((item) => item.deliveryDigest !== deliveryDigest)
        ) {
          throw new ConflictingObservationDeliveryError();
        }
      }

      const status = inserted.count === 0 ? "duplicate" as const : "accepted" as const;
      await transaction.agentCredential.update({
        data: { lastUsedAt: new Date() },
        where: { id: principal.credentialId },
      });
      await transaction.auditEvent.create({
        data: {
          actorId: `host-agent:${principal.credentialId}`,
          correlationId: observation.deliveryId,
          eventType: `host-agent.observation.${status}`,
          payload: {
            agentVersion: observation.agentVersion,
            stackCount: observation.stacks.length,
          },
          targetId: principal.hostId,
          targetType: "runner-host",
        },
      });

      return {
        acceptedStacks: inserted.count,
        deliveryId: observation.deliveryId,
        status,
      };
    });
  }
}
