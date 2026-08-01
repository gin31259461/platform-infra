import { chmod, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GitLabCredentialUnavailableError,
  installGitLabCredential,
  loadGitLabCredential,
  resolveGitLabCredentialDirectory,
} from "./credential-store";

const directories: string[] = [];

async function testDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "runner-platform-credential-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("GitLab credential store", () => {
  it("installs and loads separate owner-only credentials", async () => {
    const directory = await testDirectory();

    await installGitLabCredential({ directory, purpose: "monitoring", token: "glpat-monitoring-example" });
    await installGitLabCredential({ directory, purpose: "provisioning", token: "glpat-provisioning-example" });

    await expect(loadGitLabCredential("monitoring", directory)).resolves.toBe("glpat-monitoring-example");
    await expect(loadGitLabCredential("provisioning", directory)).resolves.toBe("glpat-provisioning-example");
    await expect(readFile(join(directory, "gitlab-monitoring.token"), "utf8"))
      .resolves.toBe("glpat-monitoring-example");
  });

  it("rejects credential files with broad permissions", async () => {
    const directory = await testDirectory();
    await installGitLabCredential({ directory, purpose: "monitoring", token: "glpat-monitoring-example" });
    await chmod(join(directory, "gitlab-monitoring.token"), 0o640);

    await expect(loadGitLabCredential("monitoring", directory))
      .rejects.toBeInstanceOf(GitLabCredentialUnavailableError);
  });

  it("rejects symlink credential targets", async () => {
    const directory = await testDirectory();
    const target = join(directory, "credential-link");
    await installGitLabCredential({ directory, purpose: "provisioning", token: "glpat-outside-example" });
    await symlink(join(directory, "gitlab-provisioning.token"), target);
    await symlink(target, join(directory, "gitlab-monitoring.token"));

    await expect(loadGitLabCredential("monitoring", directory))
      .rejects.toBeInstanceOf(GitLabCredentialUnavailableError);
  });

  it("does not follow a symlink while installing", async () => {
    const directory = await testDirectory();
    const provisioningPath = join(directory, "gitlab-provisioning.token");
    await installGitLabCredential({ directory, purpose: "provisioning", token: "glpat-unchanged-example" });
    await symlink(provisioningPath, join(directory, "gitlab-monitoring.token"));

    await expect(installGitLabCredential({
      directory,
      purpose: "monitoring",
      token: "glpat-replacement-example",
    })).rejects.toThrow("private regular file");
    await expect(readFile(provisioningPath, "utf8")).resolves.toBe("glpat-unchanged-example");
  });

  it("requires an absolute configured directory", () => {
    expect(() => resolveGitLabCredentialDirectory("relative/secrets"))
      .toThrow("must be an absolute path");
  });
});
