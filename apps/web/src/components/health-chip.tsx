import type { HealthState } from "@gitlab-runner-platform/contracts";
import { Chip } from "@mui/material";

const colorByState: Record<HealthState, "default" | "error" | "info" | "success" | "warning"> = {
  degraded: "warning",
  healthy: "success",
  maintenance: "info",
  unhealthy: "error",
  unknown: "default",
};

const labelByState: Record<HealthState, string> = {
  degraded: "Warning",
  healthy: "Healthy",
  maintenance: "Maintenance",
  unhealthy: "Unhealthy",
  unknown: "Unknown",
};

export function HealthChip({ state }: { state: HealthState }) {
  return (
    <Chip
      color={colorByState[state]}
      label={labelByState[state]}
      size="small"
      sx={{
        alignItems: "center",
        borderRadius: 1,
        fontSize: 11,
        fontWeight: 600,
        height: 22,
        "& .MuiChip-label": {
          alignItems: "center",
          display: "inline-flex",
          gap: .75,
          height: "100%",
          lineHeight: 1,
          px: 1,
          "&::before": {
            bgcolor: "currentColor",
            borderRadius: "50%",
            content: '\"\"',
            flex: "0 0 auto",
            height: 6,
            opacity: .7,
            width: 6,
          },
        },
      }}
      variant={state === "unknown" ? "outlined" : "filled"}
    />
  );
}
