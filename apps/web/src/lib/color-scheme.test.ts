import { describe, expect, it } from "vitest";

import { resolveInitialColorScheme } from "./color-scheme";

describe("initial color scheme", () => {
  it("uses a saved explicit mode", () => {
    expect(resolveInitialColorScheme("light", true)).toBe("light");
    expect(resolveInitialColorScheme("dark", false)).toBe("dark");
  });

  it("uses the system preference when no explicit mode is saved", () => {
    expect(resolveInitialColorScheme("system", true)).toBe("dark");
    expect(resolveInitialColorScheme(null, false)).toBe("light");
  });
});
