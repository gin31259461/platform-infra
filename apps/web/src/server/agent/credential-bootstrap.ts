import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "../../../generated/prisma/client";
import {
  issueAgentCredential,
  type AgentCredentialIssuance,
} from "./credential-issuance";

const stackNamePattern = /^gitlab-runners\/(frontend|dotnet)$/;

export class AgentBootstrapTargetError extends Error {
  constructor() {
    super("Host Agent bootstrap target is unavailable or ambiguous");
    this.name = "AgentBootstrapTargetError";
  }
}

export class AgentBootstrapInstallError extends Error {
  constructor() {
    super("Host Agent installation failed; the new credential was revoked");
    this.name = "AgentBootstrapInstallError";
  }
}

export class AgentBootstrapCompensationError extends Error {
  constructor() {
    super("Host Agent installation failed and credential compensation requires review");
    this.name = "AgentBootstrapCompensationError";
  }
}

export class AgentBootstrapFinalizationError extends Error {
  constructor() {
    super("Host Agent installed but superseded credential revocation requires review");
    this.name = "AgentBootstrapFinalizationError";
  }
}

export type AgentInstallerInput = {
  allowPlaintextLoopback: boolean;
  canonicalStackName: string;
  controlPlaneUrl: string;
  credentialId: string;
  hostId: string;
  runnerStackId: string;
  secret: string;
};

export type AgentBootstrapResult = AgentCredentialIssuance & {
  canonicalStackName: string;
  revokedCredentials: number;
};

type BootstrapDependencies = {
  createCorrelationId(): string;
  createSecret(): string;
  issueCredential(
    prisma: PrismaClient,
    input: { hostId: string; runnerStackId: string; secret: string },
  ): Promise<AgentCredentialIssuance>;
  now(): Date;
};

const defaultDependencies: BootstrapDependencies = {
  createCorrelationId: randomUUID,
  createSecret: () => randomBytes(32).toString("base64url"),
  issueCredential: issueAgentCredential,
  now: () => new Date(),
};

function parseControlPlaneOrigin(value: string): {
  allowPlaintextLoopback: boolean;
  controlPlaneUrl: string;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AgentBootstrapTargetError();
  }
  const normalized = url.origin;
  if (value !== normalized && value !== `${normalized}/`) {
    throw new AgentBootstrapTargetError();
  }
  if (url.protocol === "https:") {
    return { allowPlaintextLoopback: false, controlPlaneUrl: normalized };
  }
  if (
    url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  ) {
    return { allowPlaintextLoopback: true, controlPlaneUrl: normalized };
  }
  throw new AgentBootstrapTargetError();
}

async function revokeCredentials(
  prisma: PrismaClient,
  input: {
    credentialIds: string[];
    reason: "bootstrap_failed" | "superseded";
    runnerStackId: string;
  },
  dependencies: BootstrapDependencies,
): Promise<number> {
  if (input.credentialIds.length === 0) return 0;
  const now = dependencies.now();
  const correlationId = dependencies.createCorrelationId();
  return prisma.$transaction(async (transaction) => {
    const activeCredentials = await transaction.agentCredential.findMany({
      select: { id: true },
      where: {
        id: { in: input.credentialIds },
        revokedAt: null,
        runnerStackId: input.runnerStackId,
      },
    });
    const ids = activeCredentials.map((credential) => credential.id);
    if (ids.length === 0) return 0;
    await transaction.agentCredential.updateMany({
      data: { revokedAt: now },
      where: { id: { in: ids }, revokedAt: null },
    });
    await transaction.auditEvent.createMany({
      data: ids.map((credentialId) => ({
        actorId: "bootstrap-cli",
        correlationId,
        eventType: "host-agent.credential.revoked",
        occurredAt: now,
        payload: { credentialId, reason: input.reason },
        targetId: input.runnerStackId,
        targetType: "runner-stack",
      })),
    });
    return ids.length;
  });
}

export async function bootstrapAgent(
  prisma: PrismaClient,
  input: { canonicalStackName: string; controlPlaneUrl: string },
  install: (input: AgentInstallerInput) => Promise<void>,
  dependencies: BootstrapDependencies = defaultDependencies,
): Promise<AgentBootstrapResult> {
  if (!stackNamePattern.test(input.canonicalStackName)) {
    throw new AgentBootstrapTargetError();
  }
  const controlPlane = parseControlPlaneOrigin(input.controlPlaneUrl);
  const targets = await prisma.runnerStack.findMany({
    select: { hostId: true, id: true },
    take: 2,
    where: {
      canonicalName: input.canonicalStackName,
      host: { revokedAt: null },
    },
  });
  if (targets.length !== 1) throw new AgentBootstrapTargetError();
  const target = targets[0]!;

  let secret = dependencies.createSecret();
  const issuance = await dependencies.issueCredential(prisma, {
    hostId: target.hostId,
    runnerStackId: target.id,
    secret,
  });

  try {
    await install({
      ...controlPlane,
      canonicalStackName: input.canonicalStackName,
      credentialId: issuance.credentialId,
      hostId: target.hostId,
      runnerStackId: target.id,
      secret,
    });
  } catch {
    secret = "";
    try {
      await revokeCredentials(prisma, {
        credentialIds: [issuance.credentialId],
        reason: "bootstrap_failed",
        runnerStackId: target.id,
      }, dependencies);
    } catch {
      throw new AgentBootstrapCompensationError();
    }
    throw new AgentBootstrapInstallError();
  }
  secret = "";

  const superseded = await prisma.agentCredential.findMany({
    select: { id: true },
    where: {
      id: { not: issuance.credentialId },
      revokedAt: null,
      runnerStackId: target.id,
    },
  });
  let revokedCredentials: number;
  try {
    revokedCredentials = await revokeCredentials(prisma, {
      credentialIds: superseded.map((credential) => credential.id),
      reason: "superseded",
      runnerStackId: target.id,
    }, dependencies);
  } catch {
    throw new AgentBootstrapFinalizationError();
  }

  return {
    ...issuance,
    canonicalStackName: input.canonicalStackName,
    revokedCredentials,
  };
}
