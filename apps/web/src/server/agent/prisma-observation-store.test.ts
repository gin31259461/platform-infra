import { contractVersion, type HostAgentObservation } from "@gitlab-runner-platform/contracts";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../../generated/prisma/client";
import { PrismaHostAgentObservationStore } from "./prisma-observation-store";

const principal = {
  credentialId: "hac_abcdefghijklmnop",
  hostId: "host-01",
  runnerStackId: "frontend-main",
};
const observation: HostAgentObservation = {
  agentVersion: "0.1.0",
  contractVersion,
  deliveryId: "b08629f8-dfa8-4d2f-a720-3f593b195033",
  hostId: "host-01",
  observedAt: "2026-07-31T08:59:39.000Z",
  stacks: [{
    checks: [{ key: "vpn", state: "healthy", summary: "VPN interface is available" }],
    drift: [],
    id: "frontend-main",
    jobsRunning: 0,
    runnerVersion: "17.11.1",
    stackName: "gitlab-runners/frontend",
    tags: ["frontend", "podman"],
    workload: "frontend",
  }],
};

function prismaWithInsertCount(insertedCount: number, registered = true, existingDigest?: string) {
  const transaction = {
    agentCredential: { update: vi.fn(async () => ({})) },
    auditEvent: { create: vi.fn(async () => ({})) },
    observation: {
      createMany: vi.fn(async () => ({ count: insertedCount })),
      findMany: vi.fn(async () => [{ deliveryDigest: existingDigest }]),
    },
    runnerStack: {
      findMany: vi.fn(async () => registered
        ? [{ canonicalName: "gitlab-runners/frontend", id: "frontend-main", workload: "frontend" }]
        : []),
    },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
  } as unknown as PrismaClient;
  return { prisma, transaction };
}

describe("Prisma Host Agent observation persistence", () => {
  it("stores registered Stack facts and appends an audit event", async () => {
    const { prisma, transaction } = prismaWithInsertCount(1);
    const result = await new PrismaHostAgentObservationStore(prisma).persist(principal, observation);

    expect(result).toEqual({ acceptedStacks: 1, deliveryId: observation.deliveryId, status: "accepted" });
    expect(transaction.observation.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        correlationId: observation.deliveryId,
        eventType: "host-agent.observation.accepted",
      }),
    }));
  });

  it("treats a replayed delivery as an acknowledged duplicate", async () => {
    const digest = createHash("sha256").update(JSON.stringify(observation), "utf8").digest("hex");
    const { prisma } = prismaWithInsertCount(0, true, digest);
    await expect(new PrismaHostAgentObservationStore(prisma).persist(principal, observation)).resolves.toMatchObject({
      acceptedStacks: 0,
      status: "duplicate",
    });
  });

  it("rejects reuse of a delivery ID with different content", async () => {
    const { prisma } = prismaWithInsertCount(0, true, "0".repeat(64));
    await expect(new PrismaHostAgentObservationStore(prisma).persist(principal, observation)).rejects.toThrow(
      "different observation content",
    );
  });

  it("rejects unregistered or identity-mismatched Stacks before persistence", async () => {
    const { prisma, transaction } = prismaWithInsertCount(1, false);
    await expect(new PrismaHostAgentObservationStore(prisma).persist(principal, observation)).rejects.toThrow(
      "unregistered or mismatched",
    );
    expect(transaction.observation.createMany).not.toHaveBeenCalled();
  });

  it("rejects a Stack outside the credential scope before querying persistence", async () => {
    const { prisma, transaction } = prismaWithInsertCount(1);
    const crossStackObservation = {
      ...observation,
      stacks: [{ ...observation.stacks[0], id: "dotnet-main" }],
    };
    await expect(new PrismaHostAgentObservationStore(prisma).persist(
      principal,
      crossStackObservation,
    )).rejects.toThrow("unregistered or mismatched");
    expect(transaction.runnerStack.findMany).not.toHaveBeenCalled();
  });
});
