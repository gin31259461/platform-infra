import { RestGitLabRunnerDiscovery } from "../src/server/gitlab/discovery";
import { readSecretFromStandardInput } from "./lib/secret-input";

async function main(): Promise<void> {
  const baseUrl = process.env.GITLAB_BASE_URL;
  if (!baseUrl) {
    throw new Error("GITLAB_BASE_URL is required");
  }
  const token = await readSecretFromStandardInput("GitLab token");
  const runners = await new RestGitLabRunnerDiscovery({ baseUrl, token }).discover();
  process.stdout.write(`${JSON.stringify({ runners })}\n`);
}

main().catch(() => {
  process.stderr.write("GitLab Runner discovery failed\n");
  process.exitCode = 1;
});
