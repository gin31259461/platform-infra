import { Box, Container, Paper, Typography } from "@mui/material";
import Link from "next/link";

import { EmptyFleetState } from "@/components/empty-fleet-state";
import { HealthChip } from "@/components/health-chip";
import { formatAge } from "@/lib/format";
import { api } from "@/server/api/caller";

export default async function OverviewPage() {
  const fleet = await api.fleet.list();
  const summary = [
    ["Healthy", fleet.summary.healthy, "success.main"],
    ["Degraded", fleet.summary.degraded, "warning.dark"],
    ["Unhealthy", fleet.summary.unhealthy, "error.main"],
    ["Unknown", fleet.summary.unknown, "text.secondary"],
  ] as const;

  return (
    <Container component="main" maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ alignItems: { sm: "end" }, display: { sm: "flex" }, justifyContent: "space-between" }}>
        <Box>
          <Typography component="h1" fontSize={24} fontWeight={600}>Overview</Typography>
          <Typography color="text.secondary" fontSize={13} mt={.5}>
            {fleet.summary.total} Runner Stack{fleet.summary.total === 1 ? "" : "s"}
          </Typography>
        </Box>
        <Link href="/runners">
          <Typography color="primary.main" fontSize={13} mt={{ xs: 2, sm: 0 }} sx={{ "&:hover": { textDecoration: "underline" } }}>
            View all runners
          </Typography>
        </Link>
      </Box>

      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", display: "flex", flexWrap: "wrap", gap: 3, mt: 3, pb: 2 }}>
        {summary.map(([label, value, color]) => (
          <Box key={label} sx={{ alignItems: "baseline", display: "flex", gap: .75 }}>
            <Typography sx={{ color, fontSize: 18, fontWeight: 600 }}>{value}</Typography>
            <Typography color="text.secondary" fontSize={12}>{label}</Typography>
          </Box>
        ))}
      </Box>

      <Paper sx={{ border: "1px solid", borderColor: "divider", mt: 3, overflow: "hidden" }} variant="outlined">
        <Box sx={{ bgcolor: "#f6f8fa", borderBottom: "1px solid", borderColor: "divider", px: 2, py: 1.25 }}>
          <Typography fontSize={13} fontWeight={600}>Runner Stacks</Typography>
        </Box>
        {fleet.stacks.length === 0
          ? <EmptyFleetState />
          : fleet.stacks.map((stack, index) => (
            <Link href={`/runners/${stack.id}`} key={stack.id}>
              <Box
                sx={{
                  alignItems: { md: "center" },
                  borderBottom: index < fleet.stacks.length - 1 ? "1px solid" : 0,
                  borderColor: "divider",
                  display: "grid",
                  gap: { xs: 1, md: 2 },
                  gridTemplateColumns: { md: "minmax(220px, 1fr) 150px 140px 100px" },
                  px: 2,
                  py: 1.5,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Box>
                  <Typography fontSize={13} fontWeight={600}>{stack.projectPath ?? stack.stackName}</Typography>
                  <Typography color="text.secondary" fontSize={11}>{stack.id}</Typography>
                </Box>
                <Typography color="text.secondary" fontFamily="monospace" fontSize={12}>{stack.workload}</Typography>
                <Typography color="text.secondary" fontSize={12}>
                  Host {formatAge(stack.observedAt, fleet.generatedAt)}
                </Typography>
                <Box><HealthChip state={stack.state} /></Box>
              </Box>
            </Link>
          ))}
      </Paper>
    </Container>
  );
}
