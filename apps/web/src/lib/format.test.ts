import { describe, expect, it } from "vitest";

import { formatAge, formatGitLabRecordState } from "./format";

describe("observation age presentation", () => {
  it("shows the exact whole-second age for new observations", () => {
    expect(formatAge("2026-08-01T09:00:00.000Z", "2026-08-01T09:00:00.999Z"))
      .toBe("0 sec ago");
    expect(formatAge("2026-08-01T09:00:00.000Z", "2026-08-01T09:00:09.999Z"))
      .toBe("9 sec ago");
    expect(formatAge("2026-08-01T09:00:00.000Z", "2026-08-01T09:00:10.000Z"))
      .toBe("10 sec ago");
  });
});

describe("GitLab Record presentation", () => {
  it("distinguishes missing, stale, and current observations", () => {
    expect(formatGitLabRecordState("unknown", "stale", null)).toBe("Not synced");
    expect(formatGitLabRecordState("unknown", "stale", "2026-07-31T08:00:00.000Z")).toBe("Stale");
    expect(formatGitLabRecordState("online", "fresh", "2026-07-31T09:00:00.000Z")).toBe("Online");
    expect(formatGitLabRecordState("never_contacted", "fresh", "2026-07-31T09:00:00.000Z")).toBe("Never connected");
  });
});
