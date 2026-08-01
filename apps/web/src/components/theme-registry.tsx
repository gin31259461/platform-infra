"use client";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { createTheme } from "@mui/material/styles";
import type { ReactNode } from "react";

export const colorSchemes = {
  light: {
    palette: {
      mode: "light" as const,
      background: { default: "#f6f8fa", paper: "#ffffff" },
      divider: "#d0d7de",
      primary: { main: "#0969da" },
    },
  },
  dark: {
    palette: {
      mode: "dark" as const,
      background: { default: "#0d1117", paper: "#161b22" },
      divider: "#30363d",
      error: { main: "#f85149" },
      info: { main: "#58a6ff" },
      primary: { main: "#58a6ff" },
      success: { main: "#3fb950" },
      warning: { main: "#d29922" },
    },
  },
};

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "data-mui-color-scheme" },
  colorSchemes,
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    h1: { fontWeight: 600 },
    h2: { fontWeight: 600 },
    h3: { fontWeight: 600 },
    button: { fontWeight: 600, textTransform: "none" },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
  },
});

export function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider defaultMode="system" disableTransitionOnChange theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
