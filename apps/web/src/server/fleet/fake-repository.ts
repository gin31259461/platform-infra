import {
  contractVersion,
  fleetSnapshotSchema,
  type CheckObservation,
  type FleetSnapshot,
  type RunnerStackObservation,
} from "@gitlab-runner-platform/contracts";

import type { FleetRepository } from "./repository";

const secondsAgo = (now: Date, seconds: number) =>
  new Date(now.getTime() - seconds * 1_000).toISOString();

const healthyChecks: CheckObservation[] = [
  { key: "vpn", state: "healthy", summary: "tailscale0 is available" },
  { key: "dns", state: "healthy", summary: "GitLab resolved in 18 ms" },
  { key: "tls", state: "healthy", summary: "Certificate is valid for 42 days" },
  { key: "runner-manager", state: "healthy", summary: "Manager is active" },
];

function createStacks(now: Date): RunnerStackObservation[] {
  return [
    {
      id: "frontend-main",
      stackName: "gitlab-runners/frontend",
      workload: "frontend",
      hostId: "host-01",
      hostDisplayName: "runner-arch-01",
      projectPath: "shop/web-store",
      runnerRecordId: "101",
      gitlabState: "online",
      gitlabContactedAt: secondsAgo(now, 12),
      gitlabJobExecutionStatus: "running",
      gitlabObservedAt: secondsAgo(now, 10),
      observedAt: secondsAgo(now, 21),
      runnerVersion: "17.11.1",
      tags: ["frontend", "podman"],
      jobsRunning: 1,
      checks: healthyChecks,
      drift: [],
    },
    {
      id: "dotnet-orders",
      stackName: "gitlab-runners/dotnet",
      workload: "dotnet",
      hostId: "host-02",
      hostDisplayName: "runner-arch-02",
      projectPath: "core/orders-api",
      runnerRecordId: "102",
      gitlabState: "online",
      gitlabContactedAt: secondsAgo(now, 38),
      gitlabJobExecutionStatus: "idle",
      gitlabObservedAt: secondsAgo(now, 35),
      observedAt: secondsAgo(now, 44),
      runnerVersion: "17.10.0",
      tags: ["dotnet", "podman"],
      jobsRunning: 0,
      checks: [
        ...healthyChecks.filter((check) => check.key !== "dns"),
        { key: "dns", state: "degraded", summary: "GitLab resolved in 820 ms" },
      ],
      drift: [
        { field: "runner.version", summary: "Manager version differs from Desired State", reconcilable: true },
        { field: "runner.allowed_images", summary: "Image allowlist differs from Desired State", reconcilable: true },
      ],
    },
    {
      id: "frontend-admin",
      stackName: "gitlab-runners/frontend",
      workload: "frontend",
      hostId: "host-03",
      hostDisplayName: "runner-arch-03",
      projectPath: "admin/control-panel",
      runnerRecordId: "103",
      gitlabState: "stale",
      gitlabContactedAt: secondsAgo(now, 17 * 60),
      gitlabJobExecutionStatus: "idle",
      gitlabObservedAt: secondsAgo(now, 45),
      observedAt: secondsAgo(now, 53),
      runnerVersion: "17.11.1",
      tags: ["frontend", "podman"],
      jobsRunning: 0,
      checks: [
        { key: "vpn", state: "unhealthy", summary: "tailscale0 is missing" },
        { key: "dns", state: "unhealthy", summary: "GitLab hostname is unresolved" },
        { key: "tls", state: "unknown", summary: "TLS was not checked" },
        { key: "runner-manager", state: "degraded", summary: "Manager is active but cannot reach GitLab" },
      ],
      drift: [],
    },
    {
      id: "dotnet-billing",
      stackName: "gitlab-runners/dotnet",
      workload: "dotnet",
      hostId: "host-04",
      hostDisplayName: "runner-arch-04",
      projectPath: "finance/billing",
      runnerRecordId: "104",
      gitlabState: "paused",
      gitlabContactedAt: secondsAgo(now, 2 * 60 * 60),
      gitlabJobExecutionStatus: "idle",
      gitlabObservedAt: secondsAgo(now, 90),
      observedAt: secondsAgo(now, 2 * 60 * 60),
      runnerVersion: "17.9.1",
      tags: ["dotnet", "podman"],
      jobsRunning: 0,
      checks: [
        { key: "vpn", state: "unknown", summary: "No recent observation" },
        { key: "dns", state: "unknown", summary: "No recent observation" },
        { key: "tls", state: "unknown", summary: "No recent observation" },
        { key: "runner-manager", state: "unknown", summary: "Last known active" },
      ],
      drift: [{ field: "runner.version", summary: "Manager version differs from Desired State", reconcilable: true }],
    },
  ];
}

export class FakeFleetRepository implements FleetRepository {
  async getSnapshot(now: Date): Promise<FleetSnapshot> {
    return fleetSnapshotSchema.parse({
      contractVersion,
      generatedAt: now.toISOString(),
      stacks: createStacks(now),
    });
  }
}
