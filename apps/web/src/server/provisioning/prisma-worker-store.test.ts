import { describe, expect, it, vi } from "vitest";

import { OperationState, type PrismaClient } from "../../../generated/prisma/client";
import { PrismaProvisioningWorkerStore, ProvisioningLeaseLostError } from "./prisma-worker-store";

function prismaWithTransaction(transaction: object): PrismaClient {
  return {
    $transaction: vi.fn(async (callback: (client: object) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;
}

describe("Prisma provisioning worker store", () => {
  it("claims one authorized Operation with a bounded lease and validated policy", async () => {
    const now = new Date("2026-08-01T08:00:00.000Z");
    const eventCreate = vi.fn(async () => undefined);
    const transaction = {
      operation: {
        findMany: vi.fn(async () => [{
          correlationId: "f4a3ae3e-9cea-49ba-b4dc-efbe1a469d4d",
          gitlabProjectRef: { gitlabProjectId: "42", id: "project_42", path: "platform/web" },
          id: "operation-01",
          runnerTemplateRevision: {
            id: "template-revision-01",
            policy: {
              concurrency: 1,
              jobNetworkPerBuild: true,
              jobVolumes: ["/cache"],
              managerNetwork: "host",
              privileged: false,
              scope: "project",
              tags: ["frontend", "podman"],
            },
            revision: "policy-v1",
            runnerTemplate: { canonicalName: "gitlab-runners/frontend", workload: "frontend" },
          },
        }]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      operationEvent: {
        aggregate: vi.fn(async () => ({ _max: { sequence: 2 } })),
        create: eventCreate,
      },
    };
    const store = new PrismaProvisioningWorkerStore(prismaWithTransaction(transaction));

    await expect(store.claimNext({ leaseMs: 30_000, now, workerId: "worker-01" }))
      .resolves.toMatchObject({
        id: "operation-01",
        project: { gitlabProjectId: "42" },
        template: { canonicalName: "gitlab-runners/frontend" },
      });
    expect(transaction.operation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: undefined }),
    }));
    expect(transaction.operation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        leaseExpiresAt: new Date("2026-08-01T08:00:30.000Z"),
        leaseOwner: "worker-01",
        state: OperationState.DISPATCHED,
      }),
    }));
    expect(eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sequence: 3, state: OperationState.DISPATCHED }),
    }));
  });

  it("fails a transition when the worker no longer owns the lease", async () => {
    const transaction = {
      operation: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const store = new PrismaProvisioningWorkerStore(prismaWithTransaction(transaction));

    await expect(store.markCreationStarted({
      now: new Date(),
      operationId: "operation-01",
      workerId: "worker-02",
    })).rejects.toBeInstanceOf(ProvisioningLeaseLostError);
  });

  it("rejects token-shaped outcomes before persistence", async () => {
    const transaction = { operation: { updateMany: vi.fn() } };
    const store = new PrismaProvisioningWorkerStore(prismaWithTransaction(transaction));

    await expect(store.finish({
      eventType: "provisioning.failed",
      now: new Date(),
      operationId: "operation-01",
      outcome: { detail: ["glrt", "must-not-persist"].join("-") },
      state: "failed",
      workerId: "worker-01",
    })).rejects.toThrow("token-shaped");
    expect(transaction.operation.updateMany).not.toHaveBeenCalled();
  });
});
