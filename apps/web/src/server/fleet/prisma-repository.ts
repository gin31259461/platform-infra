import {
  contractVersion,
  fleetSnapshotSchema,
  gitlabRunnerObservationSchema,
  hostAgentStackObservationSchema,
  type FleetSnapshot,
  type RunnerStackObservation,
} from "@gitlab-runner-platform/contracts";

import { ObservationSource, type PrismaClient } from "../../../generated/prisma/client";
import type { FleetRepository } from "./repository";

export class PrismaFleetRepository implements FleetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getSnapshot(now: Date): Promise<FleetSnapshot> {
    const runnerStacks = await this.prisma.runnerStack.findMany({
      include: {
        host: true,
        runnerRecord: true,
      },
      orderBy: { id: "asc" },
      where: { decommissionedAt: null },
    });
    const runnerStackIds = runnerStacks.map((runnerStack) => runnerStack.id);
    const latestObservations = async (source: ObservationSource) => this.prisma.observation.findMany({
      distinct: ["runnerStackId"],
      orderBy: [
        { runnerStackId: "asc" },
        { observedAt: "desc" },
        { createdAt: "desc" },
      ],
      where: { runnerStackId: { in: runnerStackIds }, source },
    });
    const [hostObservations, gitlabObservations] = runnerStackIds.length === 0
      ? [[], []]
      : await Promise.all([
        latestObservations(ObservationSource.HOST_AGENT),
        latestObservations(ObservationSource.GITLAB),
      ]);
    const hostByStackId = new Map(hostObservations.map((observation) => [observation.runnerStackId, observation]));
    const gitlabByStackId = new Map(gitlabObservations.map((observation) => [observation.runnerStackId, observation]));

    const stacks: RunnerStackObservation[] = runnerStacks.map((runnerStack) => {
      if (runnerStack.workload !== "frontend" && runnerStack.workload !== "dotnet") {
        throw new Error(`Runner Stack ${runnerStack.id} has an unsupported workload`);
      }
      const latestHost = hostByStackId.get(runnerStack.id);
      const hostPayload = latestHost
        ? hostAgentStackObservationSchema.parse(latestHost.payload)
        : null;
      const latestGitLab = gitlabByStackId.get(runnerStack.id);
      const gitlabPayload = latestGitLab
        ? gitlabRunnerObservationSchema.parse(latestGitLab.payload)
        : null;

      if (hostPayload && (
        hostPayload.id !== runnerStack.id
        || hostPayload.stackName !== runnerStack.canonicalName
        || hostPayload.workload !== runnerStack.workload
      )) {
        throw new Error(`Persisted observation identity does not match Runner Stack ${runnerStack.id}`);
      }
      if (gitlabPayload && gitlabPayload.runnerRecordId !== runnerStack.runnerRecord?.gitlabRunnerId) {
        throw new Error(`Persisted GitLab observation identity does not match Runner Stack ${runnerStack.id}`);
      }

      return {
        checks: hostPayload?.checks ?? [{
          key: "runner-manager",
          state: "unknown",
          summary: "No Host Agent observation has been received",
        }],
        drift: hostPayload?.drift ?? null,
        gitlabContactedAt: gitlabPayload?.contactedAt ?? null,
        gitlabJobExecutionStatus: gitlabPayload?.jobExecutionStatus ?? "unknown",
        gitlabObservedAt: latestGitLab?.observedAt.toISOString() ?? null,
        gitlabState: gitlabPayload?.state ?? "unknown",
        hostDisplayName: runnerStack.host.displayName,
        hostId: runnerStack.hostId,
        id: runnerStack.id,
        jobsRunning: hostPayload?.jobsRunning ?? null,
        observedAt: latestHost?.observedAt.toISOString() ?? null,
        projectPath: runnerStack.runnerRecord?.projectPath ?? null,
        runnerRecordId: runnerStack.runnerRecord?.gitlabRunnerId ?? null,
        runnerVersion: hostPayload?.runnerVersion ?? null,
        stackName: runnerStack.canonicalName,
        tags: hostPayload?.tags ?? [],
        workload: runnerStack.workload,
      };
    });

    return fleetSnapshotSchema.parse({
      contractVersion,
      generatedAt: now.toISOString(),
      stacks,
    });
  }
}
