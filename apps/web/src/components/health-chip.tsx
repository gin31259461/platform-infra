import type { HealthState } from "@gitlab-runner-platform/contracts";
import { Box, Chip } from "@mui/material";

const colorByState: Record<HealthState, "default" | "error" | "info" | "success" | "warning"> = {
  degraded: "warning",
  healthy: "success",
  maintenance: "info",
  unhealthy: "error",
  unknown: "default",
};

export function HealthChip({ state }: { state: HealthState }) {
  return (
    <Chip
      color={colorByState[state]}
      label={(
        <Box sx={{ alignItems: "center", display: "flex", gap: .75 }}>
          <Box component="span" sx={{ bgcolor: "currentColor", borderRadius: 99, height: 6, opacity: .65, width: 6 }} />
          {state}
        </Box>
      )}
      size="small"
      sx={{ borderRadius: "4px", fontSize: 11, fontWeight: 750, height: 22, textTransform: "capitalize" }}
      variant={state === "unknown" ? "outlined" : "filled"}
    />
  );
}
