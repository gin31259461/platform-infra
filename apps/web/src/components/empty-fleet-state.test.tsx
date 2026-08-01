import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmptyFleetState } from "./empty-fleet-state";

describe("empty fleet state", () => {
  it("explains that the real PostgreSQL inventory has no Runner data", () => {
    const markup = renderToStaticMarkup(<EmptyFleetState />);

    expect(markup).toContain("No runner data");
    expect(markup).toContain("No Runner Stacks are enrolled in PostgreSQL");
  });
});
