import { installGitLabCredential } from "../src/server/gitlab/credential-store";
import { parseGitLabCredentialInstallOptions } from "./lib/gitlab-credential-options";
import { readSecretFromStandardInput } from "./lib/secret-input";

async function main(): Promise<void> {
  const options = parseGitLabCredentialInstallOptions(process.argv.slice(2));
  const token = await readSecretFromStandardInput("GitLab token");
  await installGitLabCredential({ purpose: options.purpose, token });
  process.stdout.write(`${JSON.stringify({ installed: true, purpose: options.purpose })}\n`);
}

main().catch(() => {
  process.stderr.write("GitLab credential installation failed\n");
  process.exitCode = 1;
});
