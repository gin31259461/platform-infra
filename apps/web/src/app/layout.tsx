import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { ThemeRegistry } from "@/components/theme-registry";

import "./globals.css";

export const metadata: Metadata = {
  title: "GitLab Runner Platform",
  description: "Observe and operate self-hosted GitLab Runners safely",
};

// Observations and authorization are request-scoped. Never freeze PostgreSQL
// state into a static build artifact.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>
          <AppShell>{children}</AppShell>
        </ThemeRegistry>
      </body>
    </html>
  );
}
