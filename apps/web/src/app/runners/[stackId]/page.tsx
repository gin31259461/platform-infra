import { Box, Button, Chip, Container, Divider, Paper, Stack, Typography } from "@mui/material";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { HealthChip } from "@/components/health-chip";
import { api } from "@/server/api/caller";

type RunnerStackPageProps = { params: Promise<{ stackId: string }> };

function BoundaryNode({ eyebrow, kind, label, meta }: { eyebrow: string; kind: string; label: string; meta: string }) {
  return (
    <Paper sx={{ border: "1px solid #d8dee8", borderRadius: 1, minWidth: 0, p: 2 }} variant="outlined">
      <Box sx={{ alignItems: "center", display: "flex", gap: 1.5 }}>
        <Box sx={{ bgcolor: "#edf3ff", border: "1px solid #d9e3f7", borderRadius: 1, color: "#315efb", fontSize: 9, fontWeight: 700, p: 1 }}>{kind}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography color="text.secondary" fontSize={10}>{eyebrow}</Typography>
          <Typography fontSize={13} fontWeight={700} noWrap>{label}</Typography>
          <Typography color="text.secondary" fontSize={11} noWrap>{meta}</Typography>
        </Box>
      </Box>
    </Paper>
  );
}

export default async function RunnerStackPage({ params }: RunnerStackPageProps) {
  const { stackId } = await params;
  const stack = await api.fleet.byId({ id: stackId }).catch((error: unknown) => {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  });

  return (
    <Container component="main" maxWidth="xl" sx={{ py: 4 }}>
      <Link href="/runners"><Button size="small">← Runner inventory</Button></Link>
      <Box sx={{ alignItems: { md: "center" }, display: { md: "flex" }, justifyContent: "space-between", mt: 2 }}>
        <Box>
          <Typography component="h1" fontSize={30} fontWeight={700}>{stack.projectPath ?? stack.stackName}</Typography>
          <Typography color="text.secondary" fontFamily="monospace" fontSize={13} mt={.5}>{stack.id}</Typography>
        </Box>
        <Box mt={{ xs: 2, md: 0 }}><HealthChip state={stack.state} /></Box>
      </Box>

      <Paper sx={{ border: "1px solid #d8dee8", borderRadius: 1, mt: 3, p: 2.5 }} variant="outlined">
        <Typography fontWeight={700}>Trust-boundary relationship</Typography>
        <Typography color="text.secondary" fontSize={12}>The three observations stay explicit instead of collapsing into one Runner status.</Typography>
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { md: "1fr 28px 1.1fr 28px 1fr" }, mt: 2.5 }}>
          <BoundaryNode eyebrow="RUNNER HOST" kind="HOST" label={stack.hostDisplayName} meta={stack.hostId} />
          <Box sx={{ alignItems: "center", color: "#8da0bb", display: { xs: "none", md: "flex" }, justifyContent: "center" }}>→</Box>
          <BoundaryNode eyebrow="RUNNER STACK" kind="STACK" label={stack.stackName} meta={`${stack.runnerVersion ?? "Version unknown"} · ${stack.workload}`} />
          <Box sx={{ alignItems: "center", color: "#8da0bb", display: { xs: "none", md: "flex" }, justifyContent: "center" }}>→</Box>
          <BoundaryNode
            eyebrow="GITLAB RECORD"
            kind="GL"
            label={stack.projectPath ?? "Not correlated"}
            meta={stack.runnerRecordId === null ? "No explicit Runner Record" : `${stack.gitlabState} · ${stack.gitlabJobExecutionStatus} · ID ${stack.runnerRecordId}`}
          />
        </Box>
      </Paper>

      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { lg: "1.2fr .8fr" }, mt: 3 }}>
        <Paper sx={{ border: "1px solid #d8dee8", borderRadius: 1, p: 2.5 }} variant="outlined">
          <Typography fontWeight={700}>Boundary evidence</Typography>
          <Stack divider={<Divider />} mt={1.5}>
            {stack.checks.map((check) => (
              <Box key={check.key} sx={{ alignItems: "center", display: "grid", gap: 2, gridTemplateColumns: "110px 1fr auto", py: 1.5 }}>
                <Typography fontFamily="monospace" fontSize={12} fontWeight={700}>{check.key}</Typography>
                <Typography color="text.secondary" fontSize={12}>{check.summary}</Typography>
                <HealthChip state={check.state} />
              </Box>
            ))}
          </Stack>
        </Paper>

        <Paper sx={{ border: "1px solid #d8dee8", borderRadius: 1, p: 2.5 }} variant="outlined">
          <Typography fontWeight={700}>Desired State drift</Typography>
          {stack.drift === null
            ? <Typography color="text.secondary" fontSize={13} mt={2}>Drift was not evaluated by this Agent.</Typography>
            : stack.drift.length === 0
            ? <Typography color="success.dark" fontSize={13} fontWeight={800} mt={2}>No material drift detected</Typography>
            : (
              <Stack spacing={1.5} mt={2}>
                {stack.drift.map((finding) => (
                  <Box key={finding.field} sx={{ bgcolor: "#fff7e6", border: "1px solid #f6d68b", borderRadius: 1, p: 2 }}>
                    <Typography color="#805800" fontFamily="monospace" fontSize={11}>{finding.field}</Typography>
                    <Typography color="#674b00" fontSize={12} fontWeight={800} mt={.5}>{finding.summary}</Typography>
                    <Chip label={finding.reconcilable ? "reconcilable later" : "manual review"} size="small" sx={{ borderRadius: "4px", mt: 1 }} variant="outlined" />
                  </Box>
                ))}
              </Stack>
            )}
          <Divider sx={{ my: 2 }} />
          <Typography color="text.secondary" fontSize={12}>Read-only milestone: no reconcile Operation can be requested.</Typography>
        </Paper>
      </Box>
    </Container>
  );
}
