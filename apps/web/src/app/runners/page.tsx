import { Chip, Container, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import Link from "next/link";

import { EmptyFleetState } from "@/components/empty-fleet-state";
import { HealthChip } from "@/components/health-chip";
import { formatAge, formatGitLabRecordState } from "@/lib/format";
import { api } from "@/server/api/caller";

export default async function RunnerInventoryPage() {
  const fleet = await api.fleet.list();

  return (
    <Container component="main" maxWidth="lg" sx={{ py: 4 }}>
      <Typography component="h1" fontSize={24} fontWeight={600}>Runners</Typography>
      <Typography color="text.secondary" fontSize={13} mt={.5}>
        GitLab and Host observations are evaluated independently.
      </Typography>

      <Paper sx={{ border: "1px solid", borderColor: "divider", mt: 3, overflow: "hidden" }} variant="outlined">
        <TableContainer>
          <Table aria-label="Runner Stack inventory" size="small" sx={{ minWidth: 900 }}>
            <TableHead sx={{ bgcolor: "#f6f8fa" }}>
              <TableRow>
                <TableCell>Runner</TableCell>
                <TableCell>Health</TableCell>
                <TableCell>GitLab</TableCell>
                <TableCell>Host observation</TableCell>
                <TableCell>Drift</TableCell>
                <TableCell>Jobs</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {fleet.stacks.length === 0
                ? (
                  <TableRow>
                    <TableCell colSpan={6}><EmptyFleetState /></TableCell>
                  </TableRow>
                )
                : fleet.stacks.map((stack) => (
                  <TableRow hover key={stack.id}>
                    <TableCell>
                      <Link href={`/runners/${stack.id}`}>
                        <Typography color="primary.main" fontSize={13} fontWeight={600} sx={{ "&:hover": { textDecoration: "underline" } }}>
                          {stack.projectPath ?? stack.stackName}
                        </Typography>
                      </Link>
                      <Typography color="text.secondary" fontFamily="monospace" fontSize={11}>{stack.id}</Typography>
                    </TableCell>
                    <TableCell><HealthChip state={stack.state} /></TableCell>
                    <TableCell>
                      <Chip
                        color={stack.gitlabFreshness === "stale" ? "warning" : "default"}
                        label={formatGitLabRecordState(stack.gitlabState, stack.gitlabFreshness, stack.gitlabObservedAt)}
                        size="small"
                        sx={{ borderRadius: 1 }}
                        variant="outlined"
                      />
                      <Typography color="text.secondary" fontSize={11} mt={.5}>
                        {formatAge(stack.gitlabObservedAt, fleet.generatedAt)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography color={stack.freshness === "stale" ? "warning.dark" : "text.primary"} fontSize={12}>
                        {formatAge(stack.observedAt, fleet.generatedAt)}
                      </Typography>
                      <Typography color="text.secondary" fontSize={11}>{stack.hostDisplayName}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography color={stack.drift === null ? "text.secondary" : stack.drift.length ? "warning.dark" : "success.dark"} fontSize={12} fontWeight={600}>
                        {stack.drift === null ? "Not evaluated" : stack.drift.length || "None"}
                      </Typography>
                    </TableCell>
                    <TableCell><Typography fontSize={12}>{stack.jobsRunning ?? "Not reported"}</Typography></TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Container>
  );
}
