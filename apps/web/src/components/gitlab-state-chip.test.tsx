import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GitLabStateChip } from "./gitlab-state-chip";

describe("GitLab state chip", () => {
  it.each([
    ["online", "MuiChip-colorSuccess", "Online"],
    ["offline", "MuiChip-colorError", "Offline"],
    ["paused", "MuiChip-colorInfo", "Paused"],
    ["never_contacted", "MuiChip-colorWarning", "Never connected"],
  ] as const)("uses a state color for %s", (state, colorClass, label) => {
    const markup = renderToStaticMarkup(
      <GitLabStateChip freshness="fresh" observedAt="2026-08-01T09:00:00.000Z" state={state} />,
    );

    expect(markup).toContain(colorClass);
    expect(markup).toContain(label);
  });

  it("uses a warning color when GitLab data is old", () => {
    const markup = renderToStaticMarkup(
      <GitLabStateChip freshness="stale" observedAt="2026-08-01T09:00:00.000Z" state="online" />,
    );

    expect(markup).toContain("MuiChip-colorWarning");
    expect(markup).toContain("Stale");
  });
});
