import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../../generated/prisma/client";
import {
  AgentBootstrapInstallError,
  bootstrapAgent,
} from "./credential-bootstrap";

const secret = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const issuance = {
  credentialId: "hac_newcredential123",
  hostId: "host-01",
  runnerStackId: "frontend-main",
};

function dependencies() {
  let correlation = 0;
  return {
    createCorrelationId: () => `correlation-${correlation += 1}`,
    createSecret: () => secret,
    issueCredential: vi.fn(async () => issuance),
    now: () => new Date("2026-08-01T09:00:00.000Z"),
  };
}

function prismaForBootstrap(targets = [{ hostId: "host-01", id: "frontend-main" }]) {
  const transaction = {
    agentCredential: {
      findMany: vi.fn(async (query: { where: { id: { in: string[] } } }) => (
        query.where.id.in.map((id) => ({ id }))
      )),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    auditEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
    agentCredential: {
      findMany: vi.fn(async () => [{ id: "hac_oldcredential123" }]),
    },
    runnerStack: {
      findMany: vi.fn(async () => targets),
    },
  } as unknown as PrismaClient;
  return { prisma, transaction };
}

describe("one-command Host Agent bootstrap", () => {
  it("generates, installs, and then revokes superseded Stack credentials", async () => {
    const { prisma, transaction } = prismaForBootstrap();
    const deps = dependencies();
    const install = vi.fn(async () => undefined);

    await expect(bootstrapAgent(prisma, {
      canonicalStackName: "gitlab-runners/frontend",
      controlPlaneUrl: "http://127.0.0.1:3000",
    }, install, deps)).resolves.toEqual({
      ...issuance,
      canonicalStackName: "gitlab-runners/frontend",
      revokedCredentials: 1,
    });

    expect(deps.issueCredential).toHaveBeenCalledWith(prisma, {
      hostId: "host-01",
      runnerStackId: "frontend-main",
      secret,
    });
    expect(install).toHaveBeenCalledWith({
      allowPlaintextLoopback: true,
      canonicalStackName: "gitlab-runners/frontend",
      controlPlaneUrl: "http://127.0.0.1:3000",
      credentialId: issuance.credentialId,
      hostId: "host-01",
      runnerStackId: "frontend-main",
      secret,
    });
    expect(transaction.agentCredential.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { revokedAt: new Date("2026-08-01T09:00:00.000Z") },
      where: expect.objectContaining({ id: { in: ["hac_oldcredential123"] } }),
    }));
    expect(transaction.auditEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        eventType: "host-agent.credential.revoked",
        payload: { credentialId: "hac_oldcredential123", reason: "superseded" },
      })],
    });
  });

  it("revokes the newly issued credential when installation fails", async () => {
    const { prisma, transaction } = prismaForBootstrap();
    const deps = dependencies();
    const install = vi.fn(async () => {
      throw new Error("sudo denied");
    });

    await expect(bootstrapAgent(prisma, {
      canonicalStackName: "gitlab-runners/frontend",
      controlPlaneUrl: "http://127.0.0.1:3000",
    }, install, deps)).rejects.toBeInstanceOf(AgentBootstrapInstallError);
    expect(transaction.agentCredential.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: [issuance.credentialId] } }),
    }));
    expect(transaction.auditEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        payload: { credentialId: issuance.credentialId, reason: "bootstrap_failed" },
      })],
    });
  });

  it("rejects missing or ambiguous canonical Stack targets before issuing a credential", async () => {
    const install = vi.fn();
    for (const targets of [
      [],
      [
        { hostId: "host-01", id: "frontend-main" },
        { hostId: "host-02", id: "frontend-secondary" },
      ],
    ]) {
      const { prisma } = prismaForBootstrap(targets);
      const deps = dependencies();
      await expect(bootstrapAgent(prisma, {
        canonicalStackName: "gitlab-runners/frontend",
        controlPlaneUrl: "http://127.0.0.1:3000",
      }, install, deps)).rejects.toThrow("unavailable or ambiguous");
      expect(deps.issueCredential).not.toHaveBeenCalled();
    }
    expect(install).not.toHaveBeenCalled();
  });

  it("selects one explicit Stack ID when a Template has several deployed instances", async () => {
    const { prisma } = prismaForBootstrap([{ hostId: "host-01", id: "dotnet-b08629f8dfa8" }]);
    const deps = {
      ...dependencies(),
      issueCredential: vi.fn(async () => ({ ...issuance, runnerStackId: "dotnet-b08629f8dfa8" })),
    };
    await expect(bootstrapAgent(prisma, {
      canonicalStackName: "gitlab-runners/dotnet",
      controlPlaneUrl: "http://127.0.0.1:3000",
      runnerStackId: "dotnet-b08629f8dfa8",
    }, vi.fn(async () => undefined), deps)).resolves.toMatchObject({
      runnerStackId: "dotnet-b08629f8dfa8",
    });
    expect(prisma.runnerStack.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        canonicalName: "gitlab-runners/dotnet",
        decommissionedAt: null,
        id: "dotnet-b08629f8dfa8",
      }),
    }));
  });

  it("rejects non-loopback plaintext before resolving inventory", async () => {
    const { prisma } = prismaForBootstrap();
    await expect(bootstrapAgent(prisma, {
      canonicalStackName: "gitlab-runners/frontend",
      controlPlaneUrl: "http://100.64.0.15:3000",
    }, vi.fn(), dependencies())).rejects.toThrow("unavailable or ambiguous");
    expect(prisma.runnerStack.findMany).not.toHaveBeenCalled();
  });
});
