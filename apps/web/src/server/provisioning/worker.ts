import type { RunnerTemplatePolicy } from "@gitlab-runner-platform/contracts";

import {
  GitLabRunnerCreatedButHandoffFailedError,
  GitLabRunnerCreationOutcomeUnknownError,
  GitLabRunnerCreationRateLimitError,
  GitLabRunnerCreationRejectedError,
  type ProjectRunnerCreationRequest,
  type RunnerRegistrationHandoff,
} from "../gitlab/provisioning-client";

export type ClaimedProvisioningOperation = {
  correlationId: string;
  id: string;
  project: { gitlabProjectId: string; id: string; path: string };
  template: {
    canonicalName: string;
    id: string;
    policy: RunnerTemplatePolicy;
    revision: string;
    workload: "frontend" | "dotnet";
  };
};

export interface ProvisioningWorkerStore {
  claimNext(input: {
    leaseMs: number;
    now: Date;
    operationId?: string;
    workerId: string;
  }): Promise<ClaimedProvisioningOperation | null>;
  markCreationStarted(input: { now: Date; operationId: string; workerId: string }): Promise<void>;
  recordGitLabCreated(input: {
    now: Date;
    operationId: string;
    runnerRecordId: string;
    workerId: string;
  }): Promise<void>;
  finish(input: {
    eventType: string;
    now: Date;
    operationId: string;
    outcome: Record<string, string>;
    state: "failed" | "partially_failed" | "succeeded" | "unknown";
    workerId: string;
  }): Promise<void>;
}

export interface ProjectRunnerCreator {
  createAndHandoff(
    input: ProjectRunnerCreationRequest,
    handoff: RunnerRegistrationHandoff,
  ): Promise<{ runnerRecordId: string }>;
}

export interface HostProvisioner {
  provision(input: {
    authenticationToken: string;
    operation: ClaimedProvisioningOperation;
    runnerRecordId: string;
  }): Promise<{ runnerStackId: string }>;
}

export class ProvisioningWorker {
  constructor(private readonly dependencies: {
    gitlab: ProjectRunnerCreator;
    host: HostProvisioner;
    leaseMs: number;
    store: ProvisioningWorkerStore;
    workerId: string;
  }) {}

  async runOnce(now: Date, operationId?: string): Promise<{ operationId: string | null; state: string }> {
    const operation = await this.dependencies.store.claimNext({
      leaseMs: this.dependencies.leaseMs,
      now,
      operationId,
      workerId: this.dependencies.workerId,
    });
    if (!operation) return { operationId: null, state: "idle" };

    let runnerStackId: string | null = null;
    try {
      await this.dependencies.store.markCreationStarted({
        now,
        operationId: operation.id,
        workerId: this.dependencies.workerId,
      });
      const created = await this.dependencies.gitlab.createAndHandoff({
        accessLevel: "ref_protected",
        description: `runner-platform-${operation.id}`,
        locked: true,
        paused: true,
        projectId: operation.project.gitlabProjectId,
        runUntagged: false,
        tags: operation.template.policy.tags,
      }, {
        accept: async (secret) => {
          await this.dependencies.store.recordGitLabCreated({
            now,
            operationId: operation.id,
            runnerRecordId: secret.runnerRecordId,
            workerId: this.dependencies.workerId,
          });
          const provisioned = await this.dependencies.host.provision({
            authenticationToken: secret.authenticationToken,
            operation,
            runnerRecordId: secret.runnerRecordId,
          });
          runnerStackId = provisioned.runnerStackId;
        },
      });
      await this.dependencies.store.finish({
        eventType: "provisioning.succeeded",
        now,
        operationId: operation.id,
        outcome: { runnerRecordId: created.runnerRecordId, runnerStackId: runnerStackId ?? "unknown" },
        state: "succeeded",
        workerId: this.dependencies.workerId,
      });
      return { operationId: operation.id, state: "succeeded" };
    } catch (error) {
      const failure = classifyFailure(error);
      await this.dependencies.store.finish({
        eventType: failure.eventType,
        now,
        operationId: operation.id,
        outcome: failure.outcome,
        state: failure.state,
        workerId: this.dependencies.workerId,
      });
      return { operationId: operation.id, state: failure.state };
    }
  }
}

function classifyFailure(error: unknown): {
  eventType: string;
  outcome: Record<string, string>;
  state: "failed" | "partially_failed" | "unknown";
} {
  if (error instanceof GitLabRunnerCreatedButHandoffFailedError) {
    return {
      eventType: "provisioning.host_handoff_failed",
      outcome: { reason: "host_handoff_failed", runnerRecordId: error.runnerRecordId },
      state: "partially_failed",
    };
  }
  if (error instanceof GitLabRunnerCreationOutcomeUnknownError) {
    return {
      eventType: "provisioning.gitlab_outcome_unknown",
      outcome: { reason: "gitlab_outcome_unknown" },
      state: "unknown",
    };
  }
  if (error instanceof GitLabRunnerCreationRejectedError) {
    return {
      eventType: "provisioning.gitlab_rejected",
      outcome: { reason: "gitlab_rejected" },
      state: "failed",
    };
  }
  if (error instanceof GitLabRunnerCreationRateLimitError) {
    return {
      eventType: "provisioning.gitlab_rate_limited",
      outcome: { reason: "gitlab_rate_limited" },
      state: "failed",
    };
  }
  return {
    eventType: "provisioning.failed",
    outcome: { reason: "internal_failure" },
    state: "failed",
  };
}
