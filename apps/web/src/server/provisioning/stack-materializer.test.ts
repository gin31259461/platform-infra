import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { createProvisionedStackMaterializer } from "./stack-materializer";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "runner-platform-materializer-"));
  temporaryDirectories.push(root);
  const templateDirectory = join(root, "stacks/gitlab-runners/dotnet");
  await mkdir(templateDirectory, { recursive: true });
  await writeFile(join(templateDirectory, "config.yml"), [
    "stack:",
    "  id: dotnet",
    "runner:",
    "  name: template",
    "  user: template-user",
    "  container_name: template-container",
    "  service_name: template-service",
    "  concurrent: 1",
    "",
  ].join("\n"));
  return root;
}

const instance = {
  canonicalName: "gitlab-runners/dotnet" as const,
  containerName: "glr-dotnet-b08629f8dfa8",
  runnerName: "runner-platform-dotnet-b08629f8dfa8",
  runnerUser: "glr-dotnet-b08629f8dfa8",
  serviceName: "glr-dotnet-b08629f8dfa8",
  stackId: "dotnet-b08629f8dfa8",
  workload: "dotnet" as const,
};

describe("provisioned Runner Stack materializer", () => {
  it("writes a fixed, isolated config with restrictive permissions", async () => {
    const root = await projectRoot();
    await createProvisionedStackMaterializer(root)(instance);

    const path = join(root, "secrets/provisioned-stacks/dotnet-b08629f8dfa8/config.yml");
    const value = parse(await readFile(path, "utf8"));
    expect(value.runner).toMatchObject({
      container_name: "glr-dotnet-b08629f8dfa8",
      name: "runner-platform-dotnet-b08629f8dfa8",
      service_name: "glr-dotnet-b08629f8dfa8",
      user: "glr-dotnet-b08629f8dfa8",
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, "secrets/provisioned-stacks/dotnet-b08629f8dfa8"))).mode & 0o777).toBe(0o700);
  });

  it("is idempotent only for exactly matching output", async () => {
    const root = await projectRoot();
    const materialize = createProvisionedStackMaterializer(root);
    await materialize(instance);
    await expect(materialize(instance)).resolves.toBeUndefined();

    const path = join(root, "secrets/provisioned-stacks/dotnet-b08629f8dfa8/config.yml");
    await writeFile(path, "different: true\n");
    await expect(materialize(instance)).rejects.toThrow("conflicts");
  });

  it("rejects secret-bearing template fields", async () => {
    const root = await projectRoot();
    const path = join(root, "stacks/gitlab-runners/dotnet/config.yml");
    await writeFile(path, `${await readFile(path, "utf8")}token: forbidden\n`);

    await expect(createProvisionedStackMaterializer(root)(instance)).rejects.toThrow("forbidden secret");
  });
});
