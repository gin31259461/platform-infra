import { describe, expect, it } from "vitest";

import { parseGitLabCredentialInstallOptions } from "./gitlab-credential-options";

describe("GitLab credential installer options", () => {
  it("accepts direct CLI options", () => {
    expect(parseGitLabCredentialInstallOptions(["--purpose", "monitoring"]))
      .toEqual({ purpose: "monitoring" });
  });

  it("accepts pnpm's forwarded option separator", () => {
    expect(parseGitLabCredentialInstallOptions(["--", "--purpose", "provisioning"]))
      .toEqual({ purpose: "provisioning" });
  });

  it("rejects unsupported purposes and extra arguments", () => {
    expect(() => parseGitLabCredentialInstallOptions(["--purpose", "administration"]))
      .toThrow();
    expect(() => parseGitLabCredentialInstallOptions(["--purpose", "monitoring", "extra"]))
      .toThrow("Usage");
  });
});
