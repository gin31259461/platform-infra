import { randomUUID } from "node:crypto";

import {
  contractVersion,
  provisioningOperationSchema,
  type ProjectRunnerProvisioningRequest,
  type ProvisioningOperation,
} from "@gitlab-runner-platform/contracts";

import {
  OperationState,
  OperationType,
  ProvisioningStage,
  type PrismaClient,
} from "../../../generated/prisma/client";

type AuthorizedProvisioningRequest = {
  actorId: string;
  now: Date;
  request: ProjectRunnerProvisioningRequest;
};

export class ProvisioningTargetUnavailableError extends Error {
  constructor(target: "Project" | "Runner Template revision") {
    super(`${target} is not approved for provisioning`);
    this.name = "ProvisioningTargetUnavailableError";
  }
}

export class ProvisioningIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key is already associated with a different provisioning request");
    this.name = "ProvisioningIdempotencyConflictError";
  }
}

function serializeOperation(operation: {
  correlationId: string;
  gitlabProjectRefId: string;
  id: string;
  requestedAt: Date;
  runnerTemplateRevisionId: string;
  state: OperationState;
}): ProvisioningOperation {
  return provisioningOperationSchema.parse({
    correlationId: operation.correlationId,
    id: operation.id,
    projectRefId: operation.gitlabProjectRefId,
    requestedAt: operation.requestedAt.toISOString(),
    state: operation.state.toLowerCase(),
    templateRevisionId: operation.runnerTemplateRevisionId,
  });
}

export class PrismaProvisioningStore {
  constructor(private readonly prisma: PrismaClient) {}

  async requestAuthorizedOperation(input: AuthorizedProvisioningRequest): Promise<ProvisioningOperation> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.operation.findUnique({
        where: { idempotencyKey: input.request.idempotencyKey },
      });
      if (existing) {
        if (
          existing.actorId !== input.actorId
          || existing.gitlabProjectRefId !== input.request.projectRefId
          || existing.runnerTemplateRevisionId !== input.request.templateRevisionId
          || existing.reason !== input.request.reason
        ) {
          throw new ProvisioningIdempotencyConflictError();
        }
        return serializeOperation(existing);
      }

      const [project, revision] = await Promise.all([
        transaction.gitLabProjectRef.findFirst({
          select: { id: true },
          where: { enabled: true, id: input.request.projectRefId },
        }),
        transaction.runnerTemplateRevision.findFirst({
          select: { id: true },
          where: { id: input.request.templateRevisionId, retiredAt: null },
        }),
      ]);
      if (!project) throw new ProvisioningTargetUnavailableError("Project");
      if (!revision) throw new ProvisioningTargetUnavailableError("Runner Template revision");

      const operationId = randomUUID();
      const correlationId = randomUUID();
      const operation = await transaction.operation.create({
        data: {
          actorId: input.actorId,
          availableAt: input.now,
          correlationId,
          events: {
            create: [{
              eventType: "provisioning.requested",
              id: randomUUID(),
              payload: { contractVersion },
              sequence: 1,
              stage: ProvisioningStage.AUTHORIZATION,
              state: OperationState.REQUESTED,
            }, {
              eventType: "provisioning.authorized",
              id: randomUUID(),
              payload: { contractVersion },
              sequence: 2,
              stage: ProvisioningStage.AUTHORIZATION,
              state: OperationState.AUTHORIZED,
            }],
          },
          gitlabProjectRefId: project.id,
          id: operationId,
          idempotencyKey: input.request.idempotencyKey,
          parameters: {
            contractVersion,
            projectRefId: project.id,
            templateRevisionId: revision.id,
          },
          reason: input.request.reason,
          requestedAt: input.now,
          runnerTemplateRevisionId: revision.id,
          state: OperationState.AUTHORIZED,
          type: OperationType.PROVISION_PROJECT_RUNNER,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorId: input.actorId,
          correlationId,
          eventType: "provisioning.operation.authorized",
          id: randomUUID(),
          occurredAt: input.now,
          payload: {
            contractVersion,
            operationId,
            projectRefId: project.id,
            templateRevisionId: revision.id,
          },
          targetId: operationId,
          targetType: "provisioning-operation",
        },
      });
      return serializeOperation(operation);
    });
  }
}
