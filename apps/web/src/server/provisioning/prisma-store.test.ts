import { describe, expect, it, vi } from "vitest";

import { OperationState, type PrismaClient } from "../../../generated/prisma/client";
import {
  PrismaProvisioningStore,
  ProvisioningIdempotencyConflictError,
  ProvisioningTargetUnavailableError,
} from "./prisma-store";

const now = new Date("2026-08-01T08:00:00.000Z");
const input = {
  actorId: "operator",
  now,
  request: {
    idempotencyKey: "b08629f8-dfa8-4d2f-a720-3f593b195033",
    projectRefId: "project-web",
    reason: "Add isolated frontend capacity",
    templateRevisionId: "template-frontend-v1",
  },
};

function prismaWithTransaction(transaction: object): PrismaClient {
  return {
    $transaction: vi.fn(async (callback: (client: object) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;
}

describe("Prisma provisioning store", () => {
  it("returns the original Operation for an identical idempotent request", async () => {
    const operation = {
      actorId: input.actorId,
      correlationId: "f4a3ae3e-9cea-49ba-b4dc-efbe1a469d4d",
      gitlabProjectRefId: input.request.projectRefId,
      id: "operation-01",
      reason: input.request.reason,
      requestedAt: now,
      runnerTemplateRevisionId: input.request.templateRevisionId,
      state: OperationState.AUTHORIZED,
    };
    const transaction = {
      operation: {
        create: vi.fn(),
        findUnique: vi.fn(async () => operation),
      },
    };

    await expect(new PrismaProvisioningStore(prismaWithTransaction(transaction))
      .requestAuthorizedOperation(input)).resolves.toMatchObject({
      id: "operation-01",
      state: "authorized",
    });
    expect(transaction.operation.create).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key for different intent", async () => {
    const transaction = {
      operation: {
        findUnique: vi.fn(async () => ({
          actorId: input.actorId,
          correlationId: "f4a3ae3e-9cea-49ba-b4dc-efbe1a469d4d",
          gitlabProjectRefId: "different-project",
          id: "operation-01",
          reason: input.request.reason,
          requestedAt: now,
          runnerTemplateRevisionId: input.request.templateRevisionId,
          state: OperationState.AUTHORIZED,
        })),
      },
    };

    await expect(new PrismaProvisioningStore(prismaWithTransaction(transaction))
      .requestAuthorizedOperation(input)).rejects.toBeInstanceOf(ProvisioningIdempotencyConflictError);
  });

  it("atomically records authorization events and a redacted audit event", async () => {
    const operationCreate = vi.fn(async ({ data }) => ({
      ...data,
      requestedAt: now,
    }));
    const auditCreate = vi.fn(async () => undefined);
    const transaction = {
      auditEvent: { create: auditCreate },
      gitLabProjectRef: { findFirst: vi.fn(async () => ({ id: input.request.projectRefId })) },
      operation: { create: operationCreate, findUnique: vi.fn(async () => null) },
      runnerTemplateRevision: { findFirst: vi.fn(async () => ({ id: input.request.templateRevisionId })) },
    };

    await expect(new PrismaProvisioningStore(prismaWithTransaction(transaction))
      .requestAuthorizedOperation(input)).resolves.toMatchObject({ state: "authorized" });
    expect(operationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        events: { create: [
          expect.objectContaining({ sequence: 1, state: OperationState.REQUESTED }),
          expect.objectContaining({ sequence: 2, state: OperationState.AUTHORIZED }),
        ] },
        parameters: {
          contractVersion: "1.0",
          projectRefId: input.request.projectRefId,
          templateRevisionId: input.request.templateRevisionId,
        },
      }),
    }));
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(JSON.stringify(auditCreate.mock.calls)).not.toMatch(/glrt-|glpat-|token/i);
  });

  it("rejects disabled or retired catalog targets before creating an Operation", async () => {
    const transaction = {
      gitLabProjectRef: { findFirst: vi.fn(async () => null) },
      operation: { create: vi.fn(), findUnique: vi.fn(async () => null) },
      runnerTemplateRevision: { findFirst: vi.fn(async () => ({ id: input.request.templateRevisionId })) },
    };

    await expect(new PrismaProvisioningStore(prismaWithTransaction(transaction))
      .requestAuthorizedOperation(input)).rejects.toBeInstanceOf(ProvisioningTargetUnavailableError);
    expect(transaction.operation.create).not.toHaveBeenCalled();
  });
});
