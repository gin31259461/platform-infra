import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, stringify } from "yaml";

import type { ProvisionedRunnerInstance } from "./instance";

const forbiddenKeys = new Set([
  "password",
  "private_key",
  "registration_token",
  "runner_token",
  "token",
  "vpn_private_key",
]);
const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectSecrets(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectSecrets);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key.toLowerCase())) {
      throw new Error("Runner Template configuration contains a forbidden secret field");
    }
    rejectSecrets(child);
  }
}

function validateInstance(input: ProvisionedRunnerInstance): void {
  const suffix = input.stackId.match(new RegExp(`^${input.workload}-([a-f0-9]{12})$`))?.[1];
  if (
    input.canonicalName !== `gitlab-runners/${input.workload}`
    || suffix === undefined
    || input.runnerUser !== `glr-${input.workload}-${suffix}`
    || input.containerName !== input.runnerUser
    || input.serviceName !== input.runnerUser
    || input.runnerName !== `runner-platform-${input.workload}-${suffix}`
  ) {
    throw new Error("Provisioned Runner Stack identity is invalid");
  }
}

async function loadTemplate(root: string, input: ProvisionedRunnerInstance): Promise<Record<string, unknown>> {
  const path = join(root, "stacks", input.canonicalName, "config.yml");
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Runner Template configuration is unsafe");
  }
  const value: unknown = parse(await readFile(path, "utf8"), { maxAliasCount: 0 });
  if (!isRecord(value)) {
    throw new Error("Runner Template configuration must be a mapping");
  }
  rejectSecrets(value);
  if (!isRecord(value.stack) || value.stack.id !== input.workload) {
    throw new Error("Runner Template configuration identity is inconsistent");
  }
  if (!isRecord(value.runner)) {
    throw new Error("Runner Template configuration is missing runner settings");
  }
  value.runner = {
    ...value.runner,
    container_name: input.containerName,
    name: input.runnerName,
    service_name: input.serviceName,
    user: input.runnerUser,
  };
  return value;
}

async function writeConfig(path: string, rendered: string): Promise<void> {
  const directory = dirname(path);
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error("Provisioned configuration directory is unsafe");
  }
  await chmod(directory, 0o700);

  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Existing provisioned configuration is unsafe");
    }
    if (await readFile(path, "utf8") !== rendered) {
      throw new Error("Existing provisioned configuration conflicts with this Operation");
    }
    await chmod(path, 0o600);
    return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const temporaryPath = join(directory, `.config.${randomUUID()}.tmp`);
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(rendered, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, path);
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Provisioned configuration directory is unsafe");
  }
  await chmod(path, 0o700);
}

export function createProvisionedStackMaterializer(root: string) {
  return async function materialize(input: ProvisionedRunnerInstance): Promise<void> {
    validateInstance(input);
    const config = await loadTemplate(root, input);
    const secretsDirectory = join(root, "secrets");
    const provisionedDirectory = join(secretsDirectory, "provisioned-stacks");
    const instanceDirectory = join(provisionedDirectory, input.stackId);
    await ensurePrivateDirectory(secretsDirectory);
    await ensurePrivateDirectory(provisionedDirectory);
    await ensurePrivateDirectory(instanceDirectory);
    const destination = join(
      instanceDirectory,
      "config.yml",
    );
    await writeConfig(destination, stringify(config, { lineWidth: 0 }));
  };
}

export const materializeProvisionedStack = createProvisionedStackMaterializer(repositoryRoot);
