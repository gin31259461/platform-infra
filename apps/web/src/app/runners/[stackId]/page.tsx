import { Box, Container, Paper, Table, TableBody, TableCell, TableRow, Typography } from "@mui/material";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HealthChip } from "@/components/health-chip";
import { formatAge, formatGitLabRecordState } from "@/lib/format";
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
    ["Workload", stack.workload],
    ["Runner Host", `${stack.hostDisplayName} (${stack.hostId})`],
    ["Project", stack.projectPath ?? "Not correlated"],
    ["GitLab Runner ID", stack.runnerRecordId ?? "Not correlated"],
    ["GitLab state", formatGitLabRecordState(stack.gitlabState, stack.gitlabFreshness, stack.gitlabObservedAt)],
    ["GitLab observation", formatAge(stack.gitlabObservedAt, now)],
    ["Host observation", formatAge(stack.observedAt, now)],
    ["Runner version", stack.runnerVersion ?? "Not reported"],
    ["Jobs", stack.jobsRunning?.toString() ?? "Not reported"],
  ] as const;

  return (
    <Container component="main" maxWidth="lg" sx={{ py: 4 }}>
      <Link href="/runners">
        <Typography color="primary.main" fontSize={13} sx={{ "&:hover": { textDecoration: "underline" } }}>← Runners</Typography>
      </Link>
      <Box sx={{ alignItems: "center", display: "flex", justifyContent: "space-between", mt: 2 }}>
        <Box>
          <Typography component="h1" fontSize={24} fontWeight={600}>{stack.projectPath ?? stack.stackName}</Typography>
          <Typography color="text.secondary" fontFamily="monospace" fontSize={12} mt={.5}>{stack.id}</Typography>
        </Box>
        <HealthChip state={stack.state} />
      </Box>

      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { lg: "minmax(0, 1fr) minmax(320px, .7fr)" }, mt: 3 }}>
        <Paper sx={{ border: "1px solid", borderColor: "divider", overflow: "hidden" }} variant="outlined">
          <Box sx={{ bgcolor: "#f6f8fa", borderBottom: "1px solid", borderColor: "divider", px: 2, py: 1.25 }}>
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
          <Box sx={{ bgcolor: "#f6f8fa", borderBottom: "1px solid", borderColor: "divider", px: 2, py: 1.25 }}>
            <Typography fontSize={13} fontWeight={600}>Drift</Typography>
          </Box>
          {stack.drift === null
            ? <Typography color="text.secondary" fontSize={13} p={2}>Not evaluated</Typography>
            : stack.drift.length === 0
              ? <Typography color="success.dark" fontSize={13} p={2}>No material drift</Typography>
              : stack.drift.map((finding) => (
                <Box key={finding.field} sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2, "&:last-child": { borderBottom: 0 } }}>
                  <Typography fontFamily="monospace" fontSize={11}>{finding.field}</Typography>
                  <Typography color="warning.dark" fontSize={12} mt={.5}>{finding.summary}</Typography>
                </Box>
              ))}
        </Paper>
      </Box>

      <Paper sx={{ border: "1px solid", borderColor: "divider", mt: 3, overflow: "hidden" }} variant="outlined">
        <Box sx={{ bgcolor: "#f6f8fa", borderBottom: "1px solid", borderColor: "divider", px: 2, py: 1.25 }}>
          <Typography fontSize={13} fontWeight={600}>Host checks</Typography>
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
