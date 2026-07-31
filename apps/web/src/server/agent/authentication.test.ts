import { describe, expect, it } from "vitest";

import {
  authenticateHostAgent,
  hashHostAgentSecret,
  type HostAgentCredentialRecord,
} from "./authentication";

const credentialId = "hac_abcdefghijklmnop";
const secret = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const now = new Date("2026-07-31T09:00:00.000Z");

function store(record: HostAgentCredentialRecord | null) {
  return { findById: async () => record };
}

function credential(overrides: Partial<HostAgentCredentialRecord> = {}): HostAgentCredentialRecord {
  return {
    expiresAt: null,
    hostId: "host-01",
    hostRevokedAt: null,
    id: credentialId,
    revokedAt: null,
    runnerStackId: "frontend-main",
    tokenDigest: hashHostAgentSecret(secret),
    ...overrides,
  };
}

describe("Host Agent authentication", () => {
  it("authenticates a valid host-bound Bearer credential", async () => {
    await expect(authenticateHostAgent(
      `Bearer ${credentialId}.${secret}`,
      store(credential()),
      now,
    )).resolves.toEqual({ credentialId, hostId: "host-01", runnerStackId: "frontend-main" });
  });

  it("uses one generic failure for missing and incorrect credentials", async () => {
    await expect(authenticateHostAgent(null, store(credential()), now)).rejects.toThrow(
      "Host Agent authentication failed",
    );
    await expect(authenticateHostAgent(
      `Bearer ${credentialId}.${"z".repeat(43)}`,
      store(credential()),
      now,
    )).rejects.toThrow("Host Agent authentication failed");
  });

  it("rejects expired, revoked, and host-revoked credentials", async () => {
    for (const record of [
      credential({ expiresAt: now }),
      credential({ revokedAt: now }),
      credential({ hostRevokedAt: now }),
    ]) {
      await expect(authenticateHostAgent(
        `Bearer ${credentialId}.${secret}`,
        store(record),
        now,
      )).rejects.toThrow("Host Agent authentication failed");
    }
  });

  it("rejects a legacy credential without a Runner Stack scope", async () => {
    await expect(authenticateHostAgent(
      `Bearer ${credentialId}.${secret}`,
      store(credential({ runnerStackId: null })),
      now,
    )).rejects.toThrow("Host Agent authentication failed");
  });
});
