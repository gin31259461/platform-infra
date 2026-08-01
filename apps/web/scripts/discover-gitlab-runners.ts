import { RestGitLabRunnerDiscovery } from "../src/server/gitlab/discovery";
import {
  GitLabCredentialUnavailableError,
  loadGitLabCredential,
} from "../src/server/gitlab/credential-store";

async function main(): Promise<void> {
  const baseUrl = process.env.GITLAB_BASE_URL;
  if (!baseUrl) {
    throw new Error("GITLAB_BASE_URL is required");
  }
  const token = await loadGitLabCredential("monitoring");
  const runners = await new RestGitLabRunnerDiscovery({ baseUrl, token }).discover();
  process.stdout.write(`${JSON.stringify({ runners })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof GitLabCredentialUnavailableError
    ? "Monitoring GitLab credential unavailable; run gitlab:credential:install\n"
    : "GitLab Runner discovery failed\n");
  process.exitCode = 1;
});
