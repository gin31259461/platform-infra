import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../../../generated/prisma/client";

const stackIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;

type DecommissionDependencies = {
  createCorrelationId(): string;
  now(): Date;
};

const defaultDependencies: DecommissionDependencies = {
  createCorrelationId: randomUUID,
  now: () => new Date(),
};

export class RunnerStackDecommissionError extends Error {
  constructor(message = "Runner Stack cannot be decommissioned") {
    super(message);
    this.name = "RunnerStackDecommissionError";
  }
}

export type RunnerStackDecommissionResult = {
  changed: boolean;
  decommissionedAt: Date;
  stackId: string;
};

export async function decommissionRunnerStack(
  prisma: PrismaClient,
  input: { stackId: string },
  dependencies: DecommissionDependencies = defaultDependencies,
): Promise<RunnerStackDecommissionResult> {
  if (!stackIdPattern.test(input.stackId)) throw new RunnerStackDecommissionError("Runner Stack ID is invalid");

  const now = dependencies.now();
  const correlationId = dependencies.createCorrelationId();
  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.runnerStack.updateMany({
      data: { decommissionedAt: now },
      where: { decommissionedAt: null, id: input.stackId },
    });
    if (updated.count === 0) {
      const existing = await transaction.runnerStack.findUnique({
        select: { decommissionedAt: true },
        where: { id: input.stackId },
      });
      if (!existing?.decommissionedAt) throw new RunnerStackDecommissionError("Runner Stack was not found");
      return {
        changed: false,
        decommissionedAt: existing.decommissionedAt,
        stackId: input.stackId,
      };
    }

    await transaction.agentCredential.updateMany({
      data: { revokedAt: now },
      where: { revokedAt: null, runnerStackId: input.stackId },
    });
    await transaction.auditEvent.create({
      data: {
        actorId: "uninstall-cli",
        correlationId,
        eventType: "runner-stack.decommissioned",
        occurredAt: now,
        payload: { runnerRecordPreserved: true },
        targetId: input.stackId,
        targetType: "runner-stack",
      },
    });
    return { changed: true, decommissionedAt: now, stackId: input.stackId };
  });
}
