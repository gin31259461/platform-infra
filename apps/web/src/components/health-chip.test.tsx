import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HealthChip } from "./health-chip";

describe("Health chip", () => {
  it("uses a stable CSS marker and a simple warning label", () => {
    const markup = renderToStaticMarkup(<HealthChip state="degraded" />);

    expect(markup).not.toContain('class="MuiChip-icon');
    expect(markup).toContain("::before");
    expect(markup).toContain("Warning");
  });
});
