import { Box, Chip, Container, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import Link from "next/link";

import { HealthChip } from "@/components/health-chip";
import { formatAge } from "@/lib/format";
import { api } from "@/server/api/caller";

export default async function RunnerInventoryPage() {
  const fleet = await api.fleet.list();
  const metrics = [
    ["Healthy", fleet.summary.healthy, "success.main"],
    ["Needs attention", fleet.summary.degraded + fleet.summary.unhealthy, "warning.main"],
    ["Unknown", fleet.summary.unknown, "text.secondary"],
    ["Drift findings", fleet.summary.driftFindings, "secondary.main"],
  ] as const;

  return (
    <Container component="main" maxWidth="xl" sx={{ py: 4 }}>
      <Typography component="h1" fontSize={30} fontWeight={700}>Runner stacks</Typography>
      <Typography color="text.secondary" fontSize={14} mt={.5}>GitLab state and Host Agent observations remain independently timestamped.</Typography>

      <Paper
        sx={{ border: "1px solid #d8dee8", borderRadius: 1, display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, my: 3 }}
        variant="outlined"
      >
        {metrics.map(([label, value, color], index) => (
          <Box
            key={label}
            sx={{
              borderLeft: { md: index === 0 ? 0 : "1px solid #d8dee8" },
              borderTop: { xs: index < 2 ? 0 : "1px solid #d8dee8", md: 0 },
              p: 2,
            }}
          >
            <Typography color="text.secondary" fontSize={12}>{label}</Typography>
            <Typography sx={{ color, fontSize: 26, fontWeight: 700, mt: .25 }}>{value ?? "Unknown"}</Typography>
          </Box>
        ))}
      </Paper>

      <Paper sx={{ border: "1px solid #d8dee8", borderRadius: 1, overflow: "hidden" }} variant="outlined">
        <TableContainer>
          <Table aria-label="Runner Stack inventory" size="small" sx={{ minWidth: 900 }}>
            <TableHead sx={{ bgcolor: "#f6f8fc" }}>
              <TableRow>
                <TableCell>Health</TableCell>
                <TableCell>Stack / project</TableCell>
                <TableCell>Runner Host</TableCell>
                <TableCell>GitLab Record</TableCell>
                <TableCell>Host observation</TableCell>
                <TableCell>Drift</TableCell>
                <TableCell>Jobs</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {fleet.stacks.map((stack) => (
                <TableRow hover key={stack.id}>
                  <TableCell><HealthChip state={stack.state} /></TableCell>
                  <TableCell>
                    <Link href={`/runners/${stack.id}`}>
                      <Typography fontSize={13} fontWeight={900} sx={{ color: "primary.main", "&:hover": { textDecoration: "underline" } }}>{stack.stackName}</Typography>
                    </Link>
                    <Typography color="text.secondary" fontSize={12}>{stack.projectPath ?? "Not correlated with GitLab"}</Typography>
                  </TableCell>
                  <TableCell><Typography fontFamily="monospace" fontSize={12}>{stack.hostDisplayName}</Typography></TableCell>
                  <TableCell>
                    <Chip label={stack.gitlabState} size="small" sx={{ borderRadius: "4px" }} variant="outlined" />
                    <Typography color="text.secondary" fontSize={11} mt={.5}>sync {formatAge(stack.gitlabObservedAt, fleet.generatedAt)} · {stack.gitlabFreshness}</Typography>
                    <Typography color="text.secondary" fontSize={11}>contact {formatAge(stack.gitlabContactedAt, fleet.generatedAt)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography fontSize={12}>{formatAge(stack.observedAt, fleet.generatedAt)}</Typography>
                    <Typography color="text.secondary" fontSize={11}>{stack.freshness}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography color={stack.drift === null ? "text.secondary" : stack.drift.length ? "warning.dark" : "success.dark"} fontSize={13} fontWeight={900}>
                      {stack.drift === null ? "Unknown" : stack.drift.length || "None"}
                    </Typography>
                  </TableCell>
                  <TableCell><Typography fontWeight={900}>{stack.jobsRunning ?? "Unknown"}</Typography></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Container>
  );
}
