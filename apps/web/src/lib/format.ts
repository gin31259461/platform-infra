import type { GitLabRunnerState } from "@gitlab-runner-platform/contracts";

export function formatAge(isoTimestamp: string | null, nowIsoTimestamp: string): string {
  if (isoTimestamp === null) return "No data";
  const milliseconds = Math.max(
    0,
    new Date(nowIsoTimestamp).getTime() - new Date(isoTimestamp).getTime(),
  );
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} hr ago`;
}

export function formatGitLabRecordState(
  state: GitLabRunnerState,
  freshness: "fresh" | "stale",
  observedAt: string | null,
): string {
  if (observedAt === null) return "Not synced";
  if (freshness === "stale") return "Stale";
  const labels: Record<GitLabRunnerState, string> = {
    never_contacted: "Never connected",
    offline: "Offline",
    online: "Online",
    paused: "Paused",
    stale: "Stale",
    unknown: "Unknown",
  };
  return labels[state];
}
