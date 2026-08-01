import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/theme-registry", () => ({
  ThemeRegistry: ({ children }: { children: ReactNode }) => children,
}));

import RootLayout from "./layout";

describe("root layout", () => {
  it("does not render an executable script inside the React tree", () => {
    const markup = renderToStaticMarkup(<RootLayout><main>Content</main></RootLayout>);
    expect(markup).not.toContain("<script");
  });
});
