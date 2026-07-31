"use client";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";
import type { ReactNode } from "react";

const theme = createTheme({
  palette: {
    background: { default: "#f3f6fb", paper: "#ffffff" },
    primary: { main: "#315efb" },
    secondary: { main: "#14b8a6" },
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    h1: { fontWeight: 750 },
    h2: { fontWeight: 750 },
    h3: { fontWeight: 750 },
    button: { fontWeight: 700, textTransform: "none" },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
  },
});

export function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
