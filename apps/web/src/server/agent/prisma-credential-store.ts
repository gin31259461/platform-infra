import type { PrismaClient } from "../../../generated/prisma/client";

import type {
  HostAgentCredentialRecord,
  HostAgentCredentialStore,
} from "./authentication";

export class PrismaHostAgentCredentialStore implements HostAgentCredentialStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<HostAgentCredentialRecord | null> {
    const credential = await this.prisma.agentCredential.findUnique({
      include: { runnerHost: { select: { revokedAt: true } } },
      where: { id },
    });
    if (!credential) return null;

    return {
      expiresAt: credential.expiresAt,
      hostId: credential.runnerHostId,
      hostRevokedAt: credential.runnerHost.revokedAt,
      id: credential.id,
      revokedAt: credential.revokedAt,
      runnerStackId: credential.runnerStackId,
      tokenDigest: credential.tokenDigest,
    };
  }
}
