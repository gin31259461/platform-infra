import { describe, expect, it } from "vitest";

import { colorSchemes, theme } from "./theme-registry";

describe("color theme", () => {
  it("provides light and dark colors", () => {
    expect(colorSchemes.light.palette).toMatchObject({
      mode: "light",
      background: { default: "#f6f8fa", paper: "#ffffff" },
    });
    expect(colorSchemes.dark.palette).toMatchObject({
      mode: "dark",
      background: { default: "#0d1117", paper: "#161b22" },
    });
  });

  it("uses an attribute selector so the user can override the system mode", () => {
    const cssVariablesTheme = theme as typeof theme & {
      colorSchemeSelector: string;
      getColorSchemeSelector(colorScheme: string): string;
    };
    expect(cssVariablesTheme.colorSchemeSelector).toBe("data-mui-color-scheme");
    expect(cssVariablesTheme.getColorSchemeSelector("dark")).toBe('[data-mui-color-scheme="dark"] &');
  });
});
