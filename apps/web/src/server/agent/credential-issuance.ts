import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "../../../generated/prisma/client";
import { hashHostAgentSecret } from "./authentication";

const hostIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const stackIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const secretPattern = /^[A-Za-z0-9_-]{43,128}$/;

export class InvalidAgentCredentialInputError extends Error {
  constructor() {
    super("Host Agent credential input is invalid");
    this.name = "InvalidAgentCredentialInputError";
  }
}

export class AgentCredentialTargetError extends Error {
  constructor() {
    super("Host Agent credential target is unavailable");
    this.name = "AgentCredentialTargetError";
  }
}

export type AgentCredentialIssuance = {
  credentialId: string;
  hostId: string;
  runnerStackId: string;
};

type IssuanceDependencies = {
  createCredentialId(): string;
  createCorrelationId(): string;
  now(): Date;
};

const defaultDependencies: IssuanceDependencies = {
  createCorrelationId: randomUUID,
  createCredentialId: () => `hac_${randomBytes(18).toString("base64url")}`,
  now: () => new Date(),
};

export async function issueAgentCredential(
  prisma: PrismaClient,
  input: { hostId: string; runnerStackId: string; secret: string },
  dependencies: IssuanceDependencies = defaultDependencies,
): Promise<AgentCredentialIssuance> {
  if (
    !hostIdPattern.test(input.hostId)
    || !stackIdPattern.test(input.runnerStackId)
    || !secretPattern.test(input.secret)
  ) {
    throw new InvalidAgentCredentialInputError();
  }

  const credentialId = dependencies.createCredentialId();
  const correlationId = dependencies.createCorrelationId();
  const now = dependencies.now();
  if (!/^hac_[A-Za-z0-9_-]{12,64}$/.test(credentialId)) {
    throw new Error("Generated Host Agent credential ID is invalid");
  }

  await prisma.$transaction(async (transaction) => {
    const runnerStack = await transaction.runnerStack.findUnique({
      select: {
        host: { select: { revokedAt: true } },
        hostId: true,
      },
      where: { id: input.runnerStackId },
    });
    if (
      !runnerStack
      || runnerStack.hostId !== input.hostId
      || runnerStack.host.revokedAt !== null
    ) {
      throw new AgentCredentialTargetError();
    }

    await transaction.agentCredential.create({
      data: {
        createdAt: now,
        id: credentialId,
        runnerHostId: input.hostId,
        runnerStackId: input.runnerStackId,
        tokenDigest: hashHostAgentSecret(input.secret),
      },
    });
    await transaction.auditEvent.create({
      data: {
        actorId: "bootstrap-cli",
        correlationId,
        eventType: "host-agent.credential.issued",
        occurredAt: now,
        payload: { credentialId },
        targetId: input.runnerStackId,
        targetType: "runner-stack",
      },
    });
  });

  return {
    credentialId,
    hostId: input.hostId,
    runnerStackId: input.runnerStackId,
  };
}
