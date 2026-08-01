import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../../generated/prisma/client";
import { hashHostAgentSecret } from "./authentication";
import { issueAgentCredential } from "./credential-issuance";

const secret = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const dependencies = {
  createCorrelationId: () => "b08629f8-dfa8-4d2f-a720-3f593b195033",
  createCredentialId: () => "hac_abcdefghijklmnop",
  now: () => new Date("2026-08-01T08:00:00.000Z"),
};

function prismaForTarget(options: {
  decommissionedAt?: Date | null;
  hostId?: string;
  revokedAt?: Date | null;
  targetExists?: boolean;
} = {}) {
  const transaction = {
    agentCredential: { create: vi.fn(async () => ({})) },
    auditEvent: { create: vi.fn(async () => ({})) },
    runnerStack: {
      findUnique: vi.fn(async () => options.targetExists === false ? null : ({
        decommissionedAt: options.decommissionedAt ?? null,
        host: { revokedAt: options.revokedAt ?? null },
        hostId: options.hostId ?? "host-01",
      })),
    },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
  } as unknown as PrismaClient;
  return { prisma, transaction };
}

describe("Host Agent credential issuance", () => {
  it("issues a digest-only credential for an existing Host and Runner Stack", async () => {
    const { prisma, transaction } = prismaForTarget();
    await expect(issueAgentCredential(prisma, {
      hostId: "host-01",
      runnerStackId: "frontend-main",
      secret,
    }, dependencies)).resolves.toEqual({
      credentialId: "hac_abcdefghijklmnop",
      hostId: "host-01",
      runnerStackId: "frontend-main",
    });

    expect(transaction.agentCredential.create).toHaveBeenCalledWith({
      data: {
        createdAt: new Date("2026-08-01T08:00:00.000Z"),
        id: "hac_abcdefghijklmnop",
        runnerHostId: "host-01",
        runnerStackId: "frontend-main",
        tokenDigest: hashHostAgentSecret(secret),
      },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "host-agent.credential.issued",
        payload: { credentialId: "hac_abcdefghijklmnop" },
        targetId: "frontend-main",
      }),
    }));
  });

  it("rejects missing, cross-Host, and revoked targets without creating a credential", async () => {
    for (const options of [
      { targetExists: false },
      { hostId: "host-02" },
      { revokedAt: new Date("2026-08-01T07:00:00.000Z") },
      { decommissionedAt: new Date("2026-08-01T07:00:00.000Z") },
    ]) {
      const { prisma, transaction } = prismaForTarget(options);
      await expect(issueAgentCredential(prisma, {
        hostId: "host-01",
        runnerStackId: "frontend-main",
        secret,
      }, dependencies)).rejects.toThrow("target is unavailable");
      expect(transaction.agentCredential.create).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed identifiers and secrets before starting a transaction", async () => {
    const { prisma, transaction } = prismaForTarget();
    const transactionSpy = vi.spyOn(prisma, "$transaction");
    await expect(issueAgentCredential(prisma, {
      hostId: "../host",
      runnerStackId: "frontend-main",
      secret: "short",
    }, dependencies)).rejects.toThrow("input is invalid");
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(transaction.agentCredential.create).not.toHaveBeenCalled();
  });
});
