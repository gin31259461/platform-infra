import { createHash, timingSafeEqual } from "node:crypto";

const credentialIdPattern = /^hac_[A-Za-z0-9_-]{12,64}$/;
const secretPattern = /^[A-Za-z0-9_-]{43,128}$/;

export type HostAgentCredentialRecord = {
  expiresAt: Date | null;
  id: string;
  hostId: string;
  hostRevokedAt: Date | null;
  revokedAt: Date | null;
  runnerStackId: string | null;
  tokenDigest: string;
};

export type HostAgentPrincipal = {
  credentialId: string;
  hostId: string;
  runnerStackId: string;
};

export interface HostAgentCredentialStore {
  findById(id: string): Promise<HostAgentCredentialRecord | null>;
}

export class HostAgentAuthenticationError extends Error {
  constructor() {
    super("Host Agent authentication failed");
    this.name = "HostAgentAuthenticationError";
  }
}

export function hashHostAgentSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function parseBearerCredential(authorization: string | null): { id: string; secret: string } {
  if (!authorization?.startsWith("Bearer ")) {
    throw new HostAgentAuthenticationError();
  }

  const value = authorization.slice("Bearer ".length);
  const separator = value.indexOf(".");
  const id = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  if (separator < 0 || !credentialIdPattern.test(id) || !secretPattern.test(secret)) {
    throw new HostAgentAuthenticationError();
  }
  return { id, secret };
}

function securelyMatches(actualDigest: string, expectedDigest: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) return false;
  return timingSafeEqual(Buffer.from(actualDigest, "hex"), Buffer.from(expectedDigest, "hex"));
}

export async function authenticateHostAgent(
  authorization: string | null,
  store: HostAgentCredentialStore,
  now: Date,
): Promise<HostAgentPrincipal> {
  const { id, secret } = parseBearerCredential(authorization);
  const credential = await store.findById(id);

  const tokenMatches = securelyMatches(
    hashHostAgentSecret(secret),
    credential?.tokenDigest ?? "0".repeat(64),
  );
  if (
    !tokenMatches
    || !credential
    || credential.revokedAt !== null
    || credential.hostRevokedAt !== null
    || credential.runnerStackId === null
    || (credential.expiresAt !== null && credential.expiresAt <= now)
  ) {
    throw new HostAgentAuthenticationError();
  }

  return {
    credentialId: credential.id,
    hostId: credential.hostId,
    runnerStackId: credential.runnerStackId,
  };
}
