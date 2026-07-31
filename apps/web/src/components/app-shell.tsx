import { Box, Chip, Container, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";

import { api } from "@/server/api/caller";

const navigation = [
  { href: "/", label: "Overview" },
  { href: "/runners", label: "Runner inventory" },
];

export async function AppShell({ children }: { children: ReactNode }) {
  const actor = await api.actor();
  const repositoryMode = process.env.PLATFORM_FLEET_REPOSITORY ?? "fake";

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <Box component="header" sx={{ bgcolor: "#0b1220", color: "white" }}>
        <Container maxWidth="xl" sx={{ alignItems: { md: "center" }, display: { md: "flex" }, justifyContent: "space-between", py: 2 }}>
          <Box>
            <Typography fontSize={12} fontWeight={700} sx={{ color: "#91a4c2" }}>
              GitLab Runner Platform
            </Typography>
            <Typography fontSize={16} fontWeight={750}>Control Plane</Typography>
          </Box>
          <Stack alignItems={{ xs: "flex-start", md: "center" }} direction={{ xs: "column", md: "row" }} mt={{ xs: 2, md: 0 }} spacing={2}>
            <Stack direction="row" spacing={.5}>
              {navigation.map((item) => (
                <Link href={item.href} key={item.href}>
                  <Box sx={{ borderRadius: 1, color: "#c7d2e3", fontSize: 13, fontWeight: 700, px: 1.5, py: .75, "&:hover": { bgcolor: "rgba(255,255,255,.08)", color: "white" } }}>
                    {item.label}
                  </Box>
                </Link>
              ))}
            </Stack>
            <Chip
              label={`${actor.displayName} · ${actor.roles.join(", ")}`}
              size="small"
              sx={{ bgcolor: "rgba(49,94,251,.22)", borderRadius: "4px", color: "#bed0ff", fontWeight: 700 }}
            />
          </Stack>
        </Container>
      </Box>
      <Box sx={{ bgcolor: "#fff4d6", borderBottom: "1px solid #f2cf73", color: "#674b00", py: 1 }}>
        <Container maxWidth="xl">
          <Typography fontSize={12} fontWeight={750}>
            Development stub · {repositoryMode === "postgresql" ? "PostgreSQL Host Agent observations" : "contract-validated fake observations"} · no GitLab or host operations are connected
          </Typography>
        </Container>
      </Box>
      {children}
    </Box>
  );
}
