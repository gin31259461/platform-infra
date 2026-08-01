import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../../generated/prisma/client";
import { decommissionRunnerStack } from "./decommission";

const now = new Date("2026-08-01T14:00:00.000Z");
const dependencies = {
  createCorrelationId: () => "b08629f8-dfa8-4d2f-a720-3f593b195033",
  now: () => now,
};

function prismaForDecommission(updatedCount: number, existingDecommissionedAt: Date | null = null) {
  const transaction = {
    agentCredential: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditEvent: { create: vi.fn(async () => ({})) },
    runnerStack: {
      findUnique: vi.fn(async () => ({ decommissionedAt: existingDecommissionedAt })),
      updateMany: vi.fn(async () => ({ count: updatedCount })),
    },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
  } as unknown as PrismaClient;
  return { prisma, transaction };
}

describe("Runner Stack decommissioning", () => {
  it("marks the Stack inactive, revokes credentials, and preserves durable records", async () => {
    const { prisma, transaction } = prismaForDecommission(1);

    await expect(decommissionRunnerStack(prisma, {
      stackId: "dotnet-8fa89ed0b245",
    }, dependencies)).resolves.toEqual({
      changed: true,
      decommissionedAt: now,
      stackId: "dotnet-8fa89ed0b245",
    });

    expect(transaction.runnerStack.updateMany).toHaveBeenCalledWith({
      data: { decommissionedAt: now },
      where: { decommissionedAt: null, id: "dotnet-8fa89ed0b245" },
    });
    expect(transaction.agentCredential.updateMany).toHaveBeenCalledWith({
      data: { revokedAt: now },
      where: { revokedAt: null, runnerStackId: "dotnet-8fa89ed0b245" },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "runner-stack.decommissioned",
        payload: { runnerRecordPreserved: true },
        targetId: "dotnet-8fa89ed0b245",
      }),
    });
    expect(transaction).not.toHaveProperty("runnerRecordRef.delete");
    expect(transaction).not.toHaveProperty("observation.deleteMany");
  });

  it("is idempotent when the Stack is already decommissioned", async () => {
    const decommissionedAt = new Date("2026-08-01T13:00:00.000Z");
    const { prisma, transaction } = prismaForDecommission(0, decommissionedAt);

    await expect(decommissionRunnerStack(prisma, {
      stackId: "dotnet-8fa89ed0b245",
    }, dependencies)).resolves.toEqual({
      changed: false,
      decommissionedAt,
      stackId: "dotnet-8fa89ed0b245",
    });
    expect(transaction.agentCredential.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });
});
