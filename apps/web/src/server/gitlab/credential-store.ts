import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

export const gitLabCredentialPurposes = ["monitoring", "provisioning"] as const;
export type GitLabCredentialPurpose = (typeof gitLabCredentialPurposes)[number];

const credentialPurposeSchema = z.enum(gitLabCredentialPurposes);
const tokenSchema = z.string().min(1).max(512).regex(/^\S+$/);

const credentialFileNames: Record<GitLabCredentialPurpose, string> = {
  monitoring: "gitlab-monitoring.token",
  provisioning: "gitlab-provisioning.token",
};

export class GitLabCredentialUnavailableError extends Error {
  constructor(readonly purpose: GitLabCredentialPurpose) {
    super(`The ${purpose} GitLab credential is not installed or is unsafe to read`);
    this.name = "GitLabCredentialUnavailableError";
  }
}

export function resolveGitLabCredentialDirectory(
  configuredPath = process.env.GITLAB_CREDENTIAL_DIRECTORY,
): string {
  if (configuredPath !== undefined) {
    if (!isAbsolute(configuredPath) || configuredPath.includes("\0")) {
      throw new Error("GITLAB_CREDENTIAL_DIRECTORY must be an absolute path");
    }
    return configuredPath;
  }
  return join(homedir(), ".config", "gitlab-runner-platform", "credentials");
}

function credentialPath(directory: string, purpose: GitLabCredentialPurpose): string {
  return join(directory, credentialFileNames[credentialPurposeSchema.parse(purpose)]);
}

async function assertPrivateDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  const currentUserId = process.getuid?.();
  if (
    !metadata.isDirectory()
    || (currentUserId !== undefined && metadata.uid !== currentUserId)
    || (metadata.mode & 0o077) !== 0
  ) {
    throw new Error("GitLab credential directory must be owned by the current user with mode 0700");
  }
}

export async function installGitLabCredential(input: {
  directory?: string;
  purpose: GitLabCredentialPurpose;
  token: string;
}): Promise<void> {
  const directory = input.directory ?? resolveGitLabCredentialDirectory();
  const purpose = credentialPurposeSchema.parse(input.purpose);
  const token = tokenSchema.parse(input.token);

  await mkdir(directory, { mode: 0o700, recursive: true });
  await assertPrivateDirectory(directory);

  const path = credentialPath(directory, purpose);
  try {
    const existing = await lstat(path);
    const currentUserId = process.getuid?.();
    if (
      !existing.isFile()
      || existing.isSymbolicLink()
      || existing.nlink !== 1
      || (currentUserId !== undefined && existing.uid !== currentUserId)
    ) {
      throw new Error("GitLab credential target must be a private regular file");
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const file = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const metadata = await file.stat();
    const currentUserId = process.getuid?.();
    if (
      !metadata.isFile()
      || metadata.nlink !== 1
      || (currentUserId !== undefined && metadata.uid !== currentUserId)
    ) {
      throw new Error("GitLab credential target must be a private regular file");
    }
    await file.chmod(0o600);
    await file.writeFile(token, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function loadGitLabCredential(
  purpose: GitLabCredentialPurpose,
  directory = resolveGitLabCredentialDirectory(),
): Promise<string> {
  const parsedPurpose = credentialPurposeSchema.parse(purpose);
  try {
    await assertPrivateDirectory(directory);
    const file = await open(credentialPath(directory, parsedPurpose), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await file.stat();
      const currentUserId = process.getuid?.();
      if (
        !metadata.isFile()
        || metadata.nlink !== 1
        || metadata.size > 1_024
        || (metadata.mode & 0o777) !== 0o600
        || (currentUserId !== undefined && metadata.uid !== currentUserId)
      ) {
        throw new GitLabCredentialUnavailableError(parsedPurpose);
      }
      return tokenSchema.parse(await file.readFile("utf8"));
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof GitLabCredentialUnavailableError) throw error;
    throw new GitLabCredentialUnavailableError(parsedPurpose);
  }
}
