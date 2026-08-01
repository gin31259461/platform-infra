import { gitLabProjectPathSchema } from "@gitlab-runner-platform/contracts";

import { getPrismaClient } from "../src/server/database/client";
import { loadGitLabCredential } from "../src/server/gitlab/credential-store";
import { RestGitLabProjectResolver } from "../src/server/gitlab/project-client";
import { allowGitLabProject } from "../src/server/provisioning/project-allowlist";

function parseProjectPath(values: string[]): string {
  const options = values[0] === "--" ? values.slice(1) : values;
  if (options.length !== 2 || options[0] !== "--path") {
    throw new Error("Usage: provisioning:project:allow --path namespace/project");
  }
  return gitLabProjectPathSchema.parse(options[1]);
}

async function main(): Promise<void> {
  const path = parseProjectPath(process.argv.slice(2));
  const baseUrl = process.env.GITLAB_BASE_URL;
  if (!baseUrl) throw new Error("GITLAB_BASE_URL is required");
  const token = await loadGitLabCredential("monitoring");
  const project = await new RestGitLabProjectResolver({ baseUrl, token }).resolve(path);
  const prisma = getPrismaClient();
  try {
    const allowed = await allowGitLabProject({
      actorId: "project-allowlist-cli",
      now: new Date(),
      prisma,
      project,
    });
    process.stdout.write(`${JSON.stringify({ allowed: true, project: allowed })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write("Project allowlist update failed\n");
  process.exitCode = 1;
});
