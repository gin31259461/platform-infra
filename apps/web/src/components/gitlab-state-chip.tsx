import type { GitLabRunnerState } from "@gitlab-runner-platform/contracts";
import { Chip } from "@mui/material";

import { formatGitLabRecordState } from "@/lib/format";

type GitLabStateChipProps = {
  freshness: "fresh" | "stale";
  observedAt: string | null;
  state: GitLabRunnerState;
};

const colorByState: Record<GitLabRunnerState, "default" | "error" | "info" | "success" | "warning"> = {
  never_contacted: "warning",
  offline: "error",
  online: "success",
  paused: "info",
  stale: "warning",
  unknown: "default",
};

export function GitLabStateChip({ freshness, observedAt, state }: GitLabStateChipProps) {
  const color = observedAt === null
    ? "default"
    : freshness === "stale"
      ? "warning"
      : colorByState[state];

  return (
    <Chip
      color={color}
      label={formatGitLabRecordState(state, freshness, observedAt)}
      size="small"
      sx={{ borderRadius: 1, fontSize: 11, fontWeight: 600, height: 22 }}
      variant={color === "default" ? "outlined" : "filled"}
    />
  );
}
