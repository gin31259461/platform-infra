import { randomUUID } from "node:crypto";

import { runnerTemplatePolicySchema } from "@gitlab-runner-platform/contracts";

import {
  OperationState,
  OperationType,
  Prisma,
  ProvisioningStage,
  type PrismaClient,
} from "../../../generated/prisma/client";
import type {
  ClaimedProvisioningOperation,
  ProvisioningWorkerStore,
} from "./worker";

export class ProvisioningLeaseLostError extends Error {
  constructor() {
    super("Provisioning Operation lease is no longer owned by this worker");
    this.name = "ProvisioningLeaseLostError";
  }
}

function operationState(value: "failed" | "partially_failed" | "succeeded" | "unknown"): OperationState {
  const states = {
    failed: OperationState.FAILED,
    partially_failed: OperationState.PARTIALLY_FAILED,
    succeeded: OperationState.SUCCEEDED,
    unknown: OperationState.UNKNOWN,
  } as const;
  return states[value];
}

function assertRedactedOutcome(value: Record<string, string>): void {
  const serialized = JSON.stringify(value);
  if (/(glrt-|glpat-|authorization\s*:\s*bearer)/i.test(serialized)) {
    throw new Error("Provisioning outcome contains token-shaped data");
  }
}

function normalizeWorkload(value: string): "frontend" | "dotnet" {
  if (value === "frontend" || value === "dotnet") return value;
  throw new Error("Runner Template workload is unsupported");
}

export class PrismaProvisioningWorkerStore implements ProvisioningWorkerStore {
  constructor(private readonly prisma: PrismaClient) {}

  async claimNext(input: {
    leaseMs: number;
    now: Date;
    operationId?: string;
    workerId: string;
  }): Promise<ClaimedProvisioningOperation | null> {
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 5_000 || input.leaseMs > 300_000) {
      throw new Error("Provisioning lease must be between 5000 and 300000 milliseconds");
    }
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(input.workerId)) throw new Error("Provisioning worker ID is invalid");
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);

    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.operation.findMany({
        include: {
          gitlabProjectRef: true,
          runnerTemplateRevision: { include: { runnerTemplate: true } },
        },
        orderBy: { requestedAt: "asc" },
        take: 10,
        where: {
          availableAt: { lte: input.now },
          id: input.operationId,
          OR: [
            { state: OperationState.AUTHORIZED },
            { leaseExpiresAt: { lt: input.now }, state: OperationState.DISPATCHED },
          ],
          type: OperationType.PROVISION_PROJECT_RUNNER,
        },
      });

      for (const candidate of candidates) {
        const claimed = await transaction.operation.updateMany({
          data: {
            attemptCount: { increment: 1 },
            leaseExpiresAt,
            leaseOwner: input.workerId,
            state: OperationState.DISPATCHED,
          },
          where: {
            id: candidate.id,
            OR: [
              { state: OperationState.AUTHORIZED },
              { leaseExpiresAt: { lt: input.now }, state: OperationState.DISPATCHED },
            ],
          },
        });
        if (claimed.count !== 1) continue;

        await this.appendEvent(transaction, {
          eventType: "provisioning.dispatched",
          now: input.now,
          operationId: candidate.id,
          payload: { workerId: input.workerId },
          stage: ProvisioningStage.AUTHORIZATION,
          state: OperationState.DISPATCHED,
        });
        return {
          correlationId: candidate.correlationId,
          id: candidate.id,
          project: {
            gitlabProjectId: candidate.gitlabProjectRef.gitlabProjectId,
            id: candidate.gitlabProjectRef.id,
            path: candidate.gitlabProjectRef.path,
          },
          template: {
            canonicalName: candidate.runnerTemplateRevision.runnerTemplate.canonicalName,
            id: candidate.runnerTemplateRevision.id,
            policy: runnerTemplatePolicySchema.parse(candidate.runnerTemplateRevision.policy),
            revision: candidate.runnerTemplateRevision.revision,
            workload: normalizeWorkload(candidate.runnerTemplateRevision.runnerTemplate.workload),
          },
        };
      }
      return null;
    });
  }

  async markCreationStarted(input: { now: Date; operationId: string; workerId: string }): Promise<void> {
    await this.transition({
      eventType: "provisioning.gitlab_creation_started",
      from: OperationState.DISPATCHED,
      now: input.now,
      operationId: input.operationId,
      payload: {},
      stage: ProvisioningStage.GITLAB_RUNNER_CREATION,
      to: OperationState.RUNNING,
      workerId: input.workerId,
    });
  }

  async recordGitLabCreated(input: {
    now: Date;
    operationId: string;
    runnerRecordId: string;
    workerId: string;
  }): Promise<void> {
    if (!/^[1-9][0-9]{0,19}$/.test(input.runnerRecordId)) throw new Error("Runner Record ID is invalid");
    await this.transition({
      eventType: "provisioning.gitlab_created",
      from: OperationState.RUNNING,
      now: input.now,
      operationId: input.operationId,
      payload: { runnerRecordId: input.runnerRecordId },
      stage: ProvisioningStage.GITLAB_RUNNER_CREATION,
      to: OperationState.RUNNING,
      workerId: input.workerId,
    });
  }

  async finish(input: {
    eventType: string;
    now: Date;
    operationId: string;
    outcome: Record<string, string>;
    state: "failed" | "partially_failed" | "succeeded" | "unknown";
    workerId: string;
  }): Promise<void> {
    assertRedactedOutcome(input.outcome);
    await this.transition({
      completed: true,
      eventType: input.eventType,
      from: OperationState.RUNNING,
      now: input.now,
      operationId: input.operationId,
      payload: input.outcome,
      stage: null,
      to: operationState(input.state),
      workerId: input.workerId,
    });
  }

  private async transition(input: {
    completed?: boolean;
    eventType: string;
    from: OperationState;
    now: Date;
    operationId: string;
    payload: Record<string, string>;
    stage: ProvisioningStage | null;
    to: OperationState;
    workerId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.operation.updateMany({
        data: {
          completedAt: input.completed ? input.now : undefined,
          leaseExpiresAt: input.completed ? null : undefined,
          leaseOwner: input.completed ? null : undefined,
          redactedOutcome: input.completed ? input.payload : undefined,
          state: input.to,
        },
        where: {
          id: input.operationId,
          leaseOwner: input.workerId,
          state: input.from,
        },
      });
      if (updated.count !== 1) throw new ProvisioningLeaseLostError();
      await this.appendEvent(transaction, {
        eventType: input.eventType,
        now: input.now,
        operationId: input.operationId,
        payload: input.payload,
        stage: input.stage,
        state: input.to,
      });
    });
  }

  private async appendEvent(
    transaction: Prisma.TransactionClient,
    input: {
      eventType: string;
      now: Date;
      operationId: string;
      payload: Record<string, string>;
      stage: ProvisioningStage | null;
      state: OperationState;
    },
  ): Promise<void> {
    const sequence = await transaction.operationEvent.aggregate({
      _max: { sequence: true },
      where: { operationId: input.operationId },
    });
    await transaction.operationEvent.create({
      data: {
        eventType: input.eventType,
        id: randomUUID(),
        occurredAt: input.now,
        operationId: input.operationId,
        payload: input.payload,
        sequence: (sequence._max.sequence ?? 0) + 1,
        stage: input.stage,
        state: input.state,
      },
    });
  }
}
