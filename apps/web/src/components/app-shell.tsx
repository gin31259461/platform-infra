import { Box, Container, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";

import { ObservationRefresh } from "@/components/observation-refresh";

const navigation = [
  { href: "/", label: "Overview" },
  { href: "/runners", label: "Runners" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh" }}>
      <ObservationRefresh />
      <Box component="header" sx={{ bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider" }}>
        <Container maxWidth="lg" sx={{ alignItems: "center", display: "flex", minHeight: 56 }}>
          <Link href="/">
            <Typography fontSize={15} fontWeight={650}>GitLab Runner Platform</Typography>
          </Link>
          <Stack direction="row" ml={3} spacing={.5}>
            {navigation.map((item) => (
              <Link href={item.href} key={item.href}>
                <Box sx={{ borderRadius: 1, color: "text.secondary", fontSize: 13, px: 1.25, py: .75, "&:hover": { bgcolor: "action.hover", color: "text.primary" } }}>
                  {item.label}
                </Box>
              </Link>
            ))}
          </Stack>
          <Typography color="text.secondary" fontSize={12} ml="auto">Read-only</Typography>
        </Container>
      </Box>
      {children}
    </Box>
  );
}
