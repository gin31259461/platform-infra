import { Box, Container, Paper, Table, TableBody, TableCell, TableRow, Typography } from "@mui/material";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GitLabStateChip } from "@/components/gitlab-state-chip";
import { HealthChip } from "@/components/health-chip";
import { formatAge } from "@/lib/format";
import { api } from "@/server/api/caller";

type RunnerStackPageProps = { params: Promise<{ stackId: string }> };

export default async function RunnerStackPage({ params }: RunnerStackPageProps) {
  const { stackId } = await params;
  const stack = await api.fleet.byId({ id: stackId }).catch((error: unknown) => {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const now = new Date().toISOString();

  const facts = [
    ["Stack ID", stack.id],
    ["Template", stack.stackName],
    ["Type", stack.workload],
    ["Host", `${stack.hostDisplayName} (${stack.hostId})`],
    ["Project", stack.projectPath ?? "Not linked"],
    ["GitLab Runner ID", stack.runnerRecordId ?? "Not linked"],
    ["GitLab update", formatAge(stack.gitlabObservedAt, now)],
    ["Host update", formatAge(stack.observedAt, now)],
    ["Runner version", stack.runnerVersion ?? "No data"],
    ["Jobs", stack.jobsRunning?.toString() ?? "No data"],
  ] as const;

  return (
    <Container component="main" maxWidth="lg" sx={{ py: 4 }}>
      <Link href="/runners">
        <Typography color="primary.main" fontSize={13} sx={{ "&:hover": { textDecoration: "underline" } }}>← Runners</Typography>
      </Link>
      <Box sx={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "space-between", mt: 2 }}>
        <Box>
          <Typography component="h1" fontSize={24} fontWeight={600}>{stack.projectPath ?? stack.stackName}</Typography>
          <Typography color="text.secondary" fontFamily="monospace" fontSize={12} mt={.5}>{stack.id}</Typography>
        </Box>
        <Box sx={{ alignItems: "center", display: "flex", gap: 1 }}>
          <GitLabStateChip freshness={stack.gitlabFreshness} observedAt={stack.gitlabObservedAt} state={stack.gitlabState} />
          <HealthChip state={stack.state} />
        </Box>
      </Box>

      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { lg: "minmax(0, 1fr) minmax(320px, .7fr)" }, mt: 3 }}>
        <Paper sx={{ border: "1px solid", borderColor: "divider", overflow: "hidden" }} variant="outlined">
          <Box sx={{ bgcolor: "action.hover", borderBottom: "1px solid", borderColor: "divider", px: 2, py: 1.25 }}>
            <Typography fontSize={13} fontWeight={600}>Runner details</Typography>
          </Box>
          <Table size="small">
            <TableBody>
              {facts.map(([label, value]) => (
                <TableRow key={label}>
                  <TableCell sx={{ color: "text.secondary", fontSize: 12, width: 160 }}>{label}</TableCell>
                  <TableCell sx={{ fontSize: 12 }}>{value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>

        <Paper sx={{ border: "1px solid", borderColor: "divider", overflow: "hidden" }} variant="outlined">
          <Box sx={{ bgcolor: "action.hover", borderBottom: "1px solid", borderColor: "divider", px: 2, py: 1.25 }}>
            <Typography fontSize={13} fontWeight={600}>Changes</Typography>
          </Box>
          {stack.drift === null
            ? <Typography color="text.secondary" fontSize={13} p={2}>No data</Typography>
            : stack.drift.length === 0
              ? <Typography color="success.main" fontSize={13} p={2}>No changes</Typography>
              : stack.drift.map((finding) => (
                <Box key={finding.field} sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2, "&:last-child": { borderBottom: 0 } }}>
                  <Typography fontFamily="monospace" fontSize={11}>{finding.field}</Typography>
                  <Typography color="warning.main" fontSize={12} mt={.5}>{finding.summary}</Typography>
                </Box>
              ))}
        </Paper>
      </Box>

      <Paper sx={{ border: "1px solid", borderColor: "divider", mt: 3, overflow: "hidden" }} variant="outlined">
        <Box sx={{ bgcolor: "action.hover", borderBottom: "1px solid", borderColor: "divider", px: 2, py: 1.25 }}>
          <Typography fontSize={13} fontWeight={600}>Host status</Typography>
        </Box>
        {stack.checks.map((check) => (
          <Box key={check.key} sx={{ alignItems: "center", borderBottom: "1px solid", borderColor: "divider", display: "grid", gap: 2, gridTemplateColumns: { sm: "150px 1fr auto" }, px: 2, py: 1.25, "&:last-child": { borderBottom: 0 } }}>
            <Typography fontFamily="monospace" fontSize={12}>{check.key}</Typography>
            <Typography color="text.secondary" fontSize={12}>{check.summary}</Typography>
            <HealthChip state={check.state} />
          </Box>
        ))}
      </Paper>
    </Container>
  );
}
