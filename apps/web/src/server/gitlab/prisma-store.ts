import type { GitLabRunnerObservation } from "@gitlab-runner-platform/contracts";
import { createHash } from "node:crypto";

import { ObservationSource, Prisma, type PrismaClient } from "../../../generated/prisma/client";
import type {
  GitLabObservationStore,
  GitLabRunnerTarget,
  GitLabSyncFailureReason,
} from "./sync";

export class PrismaGitLabObservationStore implements GitLabObservationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listTargets(): Promise<GitLabRunnerTarget[]> {
    const records = await this.prisma.runnerRecordRef.findMany({
      orderBy: { runnerStackId: "asc" },
      select: { gitlabRunnerId: true, runnerStackId: true },
    });
    return records.map((record) => ({
      runnerRecordId: record.gitlabRunnerId,
      runnerStackId: record.runnerStackId,
    }));
  }

  async persistObservation(
    deliveryId: string,
    target: GitLabRunnerTarget,
    observation: GitLabRunnerObservation,
  ): Promise<void> {
    if (observation.runnerRecordId !== target.runnerRecordId) {
      throw new Error("GitLab observation identity does not match its Runner target");
    }
    const deliveryDigest = createHash("sha256")
      .update(JSON.stringify(observation), "utf8")
      .digest("hex");

    await this.prisma.$transaction([
      this.prisma.observation.create({
        data: {
          deliveryDigest,
          deliveryId,
          observedAt: new Date(observation.observedAt),
          payload: observation as unknown as Prisma.InputJsonValue,
          runnerStackId: target.runnerStackId,
          schemaVersion: observation.contractVersion,
          source: ObservationSource.GITLAB,
        },
      }),
      this.prisma.auditEvent.create({
        data: {
          actorId: "gitlab-connector",
          correlationId: deliveryId,
          eventType: "gitlab.runner-observation.accepted",
          payload: { runnerRecordId: target.runnerRecordId },
          targetId: target.runnerStackId,
          targetType: "runner-stack",
        },
      }),
    ]);
  }

  async recordFailure(
    deliveryId: string,
    target: GitLabRunnerTarget,
    reason: GitLabSyncFailureReason,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorId: "gitlab-connector",
        correlationId: deliveryId,
        eventType: "gitlab.runner-observation.failed",
        payload: { reason, runnerRecordId: target.runnerRecordId },
        targetId: target.runnerStackId,
        targetType: "runner-stack",
      },
    });
  }
}
