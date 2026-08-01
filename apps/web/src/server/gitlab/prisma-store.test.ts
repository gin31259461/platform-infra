import type { GitLabRunnerObservation } from "@gitlab-runner-platform/contracts";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../../generated/prisma/client";
import { PrismaGitLabObservationStore } from "./prisma-store";

const observation: GitLabRunnerObservation = {
  contactedAt: "2026-07-31T08:59:48.000Z",
  contractVersion: "1.0",
  jobExecutionStatus: "running",
  observedAt: "2026-07-31T09:00:00.000Z",
  runnerRecordId: "101",
  state: "online",
};

function prismaClient() {
  const observationCreate = vi.fn(() => ({ operation: "observation" }));
  const auditCreate = vi.fn(() => ({ operation: "audit" }));
  const transaction = vi.fn(async () => []);
  const prisma = {
    $transaction: transaction,
    auditEvent: { create: auditCreate },
    observation: { create: observationCreate },
    runnerRecordRef: {
      findMany: vi.fn(async () => [{ gitlabRunnerId: "101", runnerStackId: "frontend-main" }]),
    },
  } as unknown as PrismaClient;
  return {
    auditCreate,
    observationCreate,
    prisma,
    runnerRecordFindMany: prisma.runnerRecordRef.findMany,
    transaction,
  };
}

describe("Prisma GitLab observation store", () => {
  it("lists only explicitly correlated Runner Records", async () => {
    const { prisma, runnerRecordFindMany } = prismaClient();
    await expect(new PrismaGitLabObservationStore(prisma).listTargets()).resolves.toEqual([
      { runnerRecordId: "101", runnerStackId: "frontend-main" },
    ]);
    expect(runnerRecordFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { runnerStack: { decommissionedAt: null } },
    }));
  });

  it("appends an immutable observation and a sanitized audit event", async () => {
    const { auditCreate, observationCreate, prisma, transaction } = prismaClient();
    await new PrismaGitLabObservationStore(prisma).persistObservation(
      "d3fdd53d-11cf-4f87-812c-1ff3787a1e99",
      { runnerRecordId: "101", runnerStackId: "frontend-main" },
      observation,
    );

    expect(transaction).toHaveBeenCalledOnce();
    expect(observationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deliveryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        deliveryId: "d3fdd53d-11cf-4f87-812c-1ff3787a1e99",
        runnerStackId: "frontend-main",
        source: "GITLAB",
      }),
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "gitlab.runner-observation.accepted",
        payload: { runnerRecordId: "101" },
      }),
    });
  });

  it("records only a stable reason when a query fails", async () => {
    const { auditCreate, prisma } = prismaClient();
    await new PrismaGitLabObservationStore(prisma).recordFailure(
      "d3fdd53d-11cf-4f87-812c-1ff3787a1e99",
      { runnerRecordId: "101", runnerStackId: "frontend-main" },
      "request_failed",
    );
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ payload: { reason: "request_failed", runnerRecordId: "101" } }),
    });
  });
});
