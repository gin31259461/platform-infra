import { describe, expect, it, vi } from "vitest";

import {
  GitLabRunnerCreatedButHandoffFailedError,
  GitLabRunnerCreationOutcomeUnknownError,
} from "../gitlab/provisioning-client";
import {
  ProvisioningWorker,
  type ClaimedProvisioningOperation,
  type ProvisioningWorkerStore,
} from "./worker";

const operation: ClaimedProvisioningOperation = {
  correlationId: "f4a3ae3e-9cea-49ba-b4dc-efbe1a469d4d",
  id: "b08629f8-dfa8-4d2f-a720-3f593b195033",
  project: { gitlabProjectId: "42", id: "project_42", path: "platform/web" },
  template: {
    canonicalName: "gitlab-runners/frontend",
    id: "template_revision_gitlab_runners_frontend_v1",
    policy: {
      concurrency: 1,
      jobNetworkPerBuild: true,
      jobVolumes: ["/cache"],
      managerNetwork: "host",
      privileged: false,
      scope: "project",
      tags: ["frontend", "podman"],
    },
    revision: "policy-v1",
    workload: "frontend",
  },
};

function workerStore(claimed: ClaimedProvisioningOperation | null = operation): ProvisioningWorkerStore {
  return {
    claimNext: vi.fn(async () => claimed),
    finish: vi.fn(async () => undefined),
    markCreationStarted: vi.fn(async () => undefined),
    recordGitLabCreated: vi.fn(async () => undefined),
  };
}

describe("Provisioning worker", () => {
  it("does nothing when the durable queue has no work", async () => {
    const store = workerStore(null);
    const worker = new ProvisioningWorker({
      gitlab: { createAndHandoff: vi.fn() },
      host: { provision: vi.fn() },
      leaseMs: 30_000,
      store,
      workerId: "worker-01",
    });

    await expect(worker.runOnce(new Date())).resolves.toEqual({ operationId: null, state: "idle" });
  });

  it("moves the one-use token directly from GitLab to the Host Provisioner", async () => {
    const token = ["glrt", "secret-value-for-handoff"].join("-");
    const store = workerStore();
    const provision = vi.fn(async () => ({ runnerStackId: "stack-01" }));
    const worker = new ProvisioningWorker({
      gitlab: {
        createAndHandoff: async (request, handoff) => {
          expect(request).toMatchObject({ locked: true, paused: true, runUntagged: false });
          await handoff.accept({ authenticationToken: token, runnerRecordId: "9171", tokenExpiresAt: null });
          return { runnerRecordId: "9171" };
        },
      },
      host: { provision },
      leaseMs: 30_000,
      store,
      workerId: "worker-01",
    });

    await expect(worker.runOnce(new Date("2026-08-01T08:00:00.000Z")))
      .resolves.toEqual({ operationId: operation.id, state: "succeeded" });
    expect(provision).toHaveBeenCalledWith(expect.objectContaining({ authenticationToken: token }));
    expect(store.recordGitLabCreated).toHaveBeenCalledWith(expect.objectContaining({ runnerRecordId: "9171" }));
    expect(store.finish).toHaveBeenCalledWith(expect.objectContaining({
      outcome: { runnerRecordId: "9171", runnerStackId: "stack-01" },
      state: "succeeded",
    }));
    expect(JSON.stringify((store.finish as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(token);
  });

  it("preserves partial and unknown outcomes without retrying GitLab", async () => {
    for (const [error, state] of [
      [new GitLabRunnerCreatedButHandoffFailedError("9171"), "partially_failed"],
      [new GitLabRunnerCreationOutcomeUnknownError(), "unknown"],
    ] as const) {
      const store = workerStore();
      const createAndHandoff = vi.fn(async () => { throw error; });
      const worker = new ProvisioningWorker({
        gitlab: { createAndHandoff },
        host: { provision: vi.fn() },
        leaseMs: 30_000,
        store,
        workerId: "worker-01",
      });

      await expect(worker.runOnce(new Date())).resolves.toEqual({ operationId: operation.id, state });
      expect(createAndHandoff).toHaveBeenCalledOnce();
      expect(store.finish).toHaveBeenCalledWith(expect.objectContaining({ state }));
    }
  });
});
