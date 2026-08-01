import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../../generated/prisma/client";
import { PrismaFleetRepository } from "./prisma-repository";

function prismaWithStacks(stacks: unknown[], observations: unknown[] = []) {
  const runnerStackFindMany = vi.fn(async () => stacks);
  const prisma = {
    observation: {
      findMany: async ({ where }: { where: { source: string } }) => observations.filter(
        (observation) => (observation as { source: string }).source === where.source,
      ),
    },
    runnerStack: { findMany: runnerStackFindMany },
  } as unknown as PrismaClient;
  return { prisma, runnerStackFindMany };
}

describe("Prisma Fleet repository", () => {
  it("builds the read model from the latest Host Agent observation", async () => {
    const { prisma, runnerStackFindMany } = prismaWithStacks([{
      canonicalName: "gitlab-runners/frontend",
      host: { displayName: "runner-arch-01" },
      hostId: "host-01",
      id: "frontend-main",
      runnerRecord: { gitlabRunnerId: "101", projectPath: "shop/web-store" },
      workload: "frontend",
    }], [{
        runnerStackId: "frontend-main",
        source: "HOST_AGENT",
        createdAt: new Date("2026-07-31T08:59:40.000Z"),
        observedAt: new Date("2026-07-31T08:59:39.000Z"),
        payload: {
          checks: [{ key: "vpn", state: "healthy", summary: "VPN interface is available" }],
          drift: [],
          id: "frontend-main",
          jobsRunning: 0,
          runnerVersion: "17.11.1",
          stackName: "gitlab-runners/frontend",
          tags: ["frontend", "podman"],
          workload: "frontend",
        },
      }, {
        runnerStackId: "frontend-main",
        source: "GITLAB",
        createdAt: new Date("2026-07-31T08:59:51.000Z"),
        observedAt: new Date("2026-07-31T08:59:50.000Z"),
        payload: {
          contactedAt: "2026-07-31T08:59:48.000Z",
          contractVersion: "1.0",
          jobExecutionStatus: "running",
          observedAt: "2026-07-31T08:59:50.000Z",
          runnerRecordId: "101",
          state: "online",
        },
      }]);
    const repository = new PrismaFleetRepository(prisma);

    await expect(repository.getSnapshot(new Date("2026-07-31T09:00:00.000Z"))).resolves.toMatchObject({
      stacks: [{
        gitlabJobExecutionStatus: "running",
        gitlabObservedAt: "2026-07-31T08:59:50.000Z",
        gitlabState: "online",
        hostId: "host-01",
        observedAt: "2026-07-31T08:59:39.000Z",
        projectPath: "shop/web-store",
      }],
    });
    expect(runnerStackFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { decommissionedAt: null },
    }));
  });

  it("shows an enrolled Stack without observations as unknown", async () => {
    const { prisma } = prismaWithStacks([{
      canonicalName: "gitlab-runners/dotnet",
      host: { displayName: "runner-arch-02" },
      hostId: "host-02",
      id: "dotnet-orders",
      runnerRecord: null,
      workload: "dotnet",
    }]);
    const repository = new PrismaFleetRepository(prisma);

    await expect(repository.getSnapshot(new Date("2026-07-31T09:00:00.000Z"))).resolves.toMatchObject({
      stacks: [{
        gitlabContactedAt: null,
        gitlabJobExecutionStatus: "unknown",
        gitlabObservedAt: null,
        observedAt: null,
        projectPath: null,
        runnerRecordId: null,
      }],
    });
  });
});
