import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ColorModeToggle } from "./color-mode-toggle";
import { ThemeRegistry } from "./theme-registry";

describe("color mode toggle", () => {
  it("keeps the button attributes stable before color mode hydration", () => {
    const markup = renderToStaticMarkup(
      <ThemeRegistry><ColorModeToggle /></ThemeRegistry>,
    );

    expect(markup).not.toContain(" disabled=\"");
    expect(markup).toContain("Mode");
  });
});
