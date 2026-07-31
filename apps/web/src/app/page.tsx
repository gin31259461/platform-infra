import { Box, Button, Container, Divider, Paper, Typography } from "@mui/material";
import Link from "next/link";

import { HealthChip } from "@/components/health-chip";
import { formatAge } from "@/lib/format";
import { api } from "@/server/api/caller";

export default async function OverviewPage() {
  const fleet = await api.fleet.list();
  const needsAttention = fleet.stacks.filter((stack) => stack.state !== "healthy");
  const healthy = fleet.stacks.filter((stack) => stack.state === "healthy");

  const metrics = [
    ["Runner stacks", fleet.summary.total],
    ["Healthy", fleet.summary.healthy],
    ["Needs attention", fleet.summary.degraded + fleet.summary.unhealthy],
    ["Unknown", fleet.summary.unknown],
    ["Running jobs", fleet.summary.jobsRunning],
    ["Drift findings", fleet.summary.driftFindings],
  ] as const;

  return (
    <Container component="main" maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ alignItems: { sm: "end" }, display: { sm: "flex" }, justifyContent: "space-between" }}>
        <Box>
          <Typography component="h1" fontSize={30} fontWeight={750}>Overview</Typography>
          <Typography color="text.secondary" fontSize={13} mt={.5}>
            Snapshot generated {formatAge(fleet.generatedAt, fleet.generatedAt)}
          </Typography>
        </Box>
        <Link href="/runners"><Button size="small" sx={{ mt: { xs: 2, sm: 0 } }} variant="outlined">View runner inventory</Button></Link>
      </Box>

      <Paper sx={{ border: "1px solid #d8dee8", borderRadius: 1, display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(6, 1fr)" }, mt: 3 }} variant="outlined">
        {metrics.map(([label, value], index) => (
          <Box
            key={label}
            sx={{
              borderBottom: { xs: index < 4 ? "1px solid #e2e7ef" : 0, md: 0 },
              borderRight: { xs: index % 2 === 0 ? "1px solid #e2e7ef" : 0, md: index < metrics.length - 1 ? "1px solid #e2e7ef" : 0 },
              px: 2,
              py: 1.75,
            }}
          >
            <Typography color="text.secondary" fontSize={11}>{label}</Typography>
            <Typography fontSize={22} fontWeight={750} mt={.25}>{value ?? "Unknown"}</Typography>
          </Box>
        ))}
      </Paper>

      <Paper sx={{ border: "1px solid #d8dee8", borderRadius: 1, mt: 3, overflow: "hidden" }} variant="outlined">
        <Box sx={{ bgcolor: "#f7f8fa", borderBottom: "1px solid #d8dee8", px: 2, py: 1.5 }}>
          <Typography fontSize={14} fontWeight={750}>Needs attention</Typography>
        </Box>
        {needsAttention.length === 0
          ? <Typography color="text.secondary" fontSize={13} p={2}>No Runner Stacks need attention.</Typography>
          : needsAttention.map((stack, index) => {
            const evidence = stack.checks.find((check) => check.state === "unhealthy" || check.state === "degraded")?.summary
              ?? "Observation is stale";
            return (
              <Link href={`/runners/${stack.id}`} key={stack.id}>
                <Box
                  sx={{
                    alignItems: { md: "center" },
                    borderBottom: index < needsAttention.length - 1 ? "1px solid #e2e7ef" : 0,
                    display: "grid",
                    gap: { xs: 1, md: 2 },
                    gridTemplateColumns: { md: "minmax(220px, 1fr) 180px 110px minmax(260px, 1.5fr)" },
                    px: 2,
                    py: 1.5,
                    "&:hover": { bgcolor: "#fafbfc" },
                  }}
                >
                  <Box>
                    <Typography fontSize={13} fontWeight={750}>{stack.projectPath ?? stack.stackName}</Typography>
                    <Typography color="text.secondary" fontSize={11}>{stack.stackName}</Typography>
                  </Box>
                  <Typography color="text.secondary" fontFamily="monospace" fontSize={12}>{stack.hostDisplayName}</Typography>
                  <Box><HealthChip state={stack.state} /></Box>
                  <Typography color="text.secondary" fontSize={12}>{evidence}</Typography>
                </Box>
              </Link>
            );
          })}
      </Paper>

      <Paper sx={{ border: "1px solid #d8dee8", borderRadius: 1, mt: 3, overflow: "hidden" }} variant="outlined">
        <Box sx={{ bgcolor: "#f7f8fa", borderBottom: "1px solid #d8dee8", px: 2, py: 1.5 }}>
          <Typography fontSize={14} fontWeight={750}>Healthy</Typography>
        </Box>
        {healthy.map((stack, index) => (
          <Box key={stack.id} sx={{ alignItems: "center", borderBottom: index < healthy.length - 1 ? "1px solid #e2e7ef" : 0, display: "grid", gap: 2, gridTemplateColumns: { sm: "1fr 180px auto" }, px: 2, py: 1.5 }}>
            <Box>
              <Typography fontSize={13} fontWeight={750}>{stack.projectPath ?? stack.stackName}</Typography>
              <Typography color="text.secondary" fontSize={11}>{stack.stackName}</Typography>
            </Box>
            <Typography color="text.secondary" fontFamily="monospace" fontSize={12}>{stack.hostDisplayName}</Typography>
            <Box><HealthChip state={stack.state} /></Box>
          </Box>
        ))}
      </Paper>

      <Divider sx={{ my: 3 }} />
      <Typography color="text.secondary" fontSize={12}>Read-only milestone. GitLab and Host Agent writes are disabled.</Typography>
    </Container>
  );
}
