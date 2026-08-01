import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../../generated/prisma/client";
import { LocalHostProvisioner } from "./local-host-provisioner";
import type { ClaimedProvisioningOperation } from "./worker";

const operation: ClaimedProvisioningOperation = {
  correlationId: "f4a3ae3e-9cea-49ba-b4dc-efbe1a469d4d",
  id: "b08629f8-dfa8-4d2f-a720-3f593b195033",
  project: { gitlabProjectId: "42", id: "project_42", path: "platform/web" },
  template: {
    canonicalName: "gitlab-runners/dotnet",
    id: "template-revision-01",
    policy: {
      concurrency: 1,
      jobNetworkPerBuild: true,
      jobVolumes: ["/cache"],
      managerNetwork: "host",
      privileged: false,
      scope: "project",
      tags: ["dotnet", "podman"],
    },
    revision: "policy-v1",
    workload: "dotnet",
  },
};

describe("Local Host Provisioner", () => {
  it("registers the isolated instance before correlating it in durable inventory", async () => {
    const createStack = vi.fn(async () => undefined);
    const createRecord = vi.fn(async () => undefined);
    const transaction = {
      auditEvent: { create: vi.fn(async () => undefined) },
      runnerRecordRef: { create: createRecord },
      runnerStack: { create: createStack },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)),
      runnerHost: { findMany: vi.fn(async () => [{ id: "host-01" }]) },
      runnerStack: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    const register = vi.fn(async () => undefined);
    const bootstrap = vi.fn(async () => undefined);
    const provisioner = new LocalHostProvisioner(prisma, register, bootstrap);
    const authenticationToken = ["glrt", "one-use-secret-for-test"].join("-");

    await expect(provisioner.provision({ authenticationToken, operation, runnerRecordId: "9171" }))
      .resolves.toEqual({ runnerStackId: "dotnet-b08629f8dfa8" });
    expect(register).toHaveBeenCalledWith({
      authenticationToken,
      canonicalName: "gitlab-runners/dotnet",
      stackId: "dotnet-b08629f8dfa8",
    });
    expect(createStack).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: "dotnet-b08629f8dfa8",
        templateRevisionId: "template-revision-01",
      }),
    }));
    expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gitlabRunnerId: "9171", projectPath: "platform/web" }),
    }));
    expect(bootstrap).toHaveBeenCalledWith({
      canonicalStackName: "gitlab-runners/dotnet",
      runnerStackId: "dotnet-b08629f8dfa8",
    });
    expect(bootstrap.mock.invocationCallOrder[0]).toBeGreaterThan(createStack.mock.invocationCallOrder[0]!);
  });

  it("returns an exactly matching durable instance without registering twice", async () => {
    const register = vi.fn(async () => undefined);
    const bootstrap = vi.fn(async () => undefined);
    const prisma = {
      runnerHost: { findMany: vi.fn(async () => [{ id: "host-01" }]) },
      runnerStack: {
        findUnique: vi.fn(async () => ({
          canonicalName: "gitlab-runners/dotnet",
          hostId: "host-01",
          id: "dotnet-b08629f8dfa8",
          runnerRecord: { gitlabRunnerId: "9171", projectPath: "platform/web" },
        })),
      },
    } as unknown as PrismaClient;

    await expect(new LocalHostProvisioner(prisma, register, bootstrap).provision({
      authenticationToken: ["glrt", "same-token"].join("-"),
      operation,
      runnerRecordId: "9171",
    })).resolves.toEqual({ runnerStackId: "dotnet-b08629f8dfa8" });
    expect(register).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
  });
});
