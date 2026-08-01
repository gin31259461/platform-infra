import { GitLabCredentialUnavailableError } from "../src/server/gitlab/credential-store";
import { createGitLabObservationRuntime } from "../src/server/gitlab/runtime";

async function main(): Promise<void> {
  const runtime = await createGitLabObservationRuntime();
  try {
    const result = await runtime.sync();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await runtime.disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof GitLabCredentialUnavailableError
    ? "Monitoring GitLab credential unavailable; run gitlab:credential:install\n"
    : "GitLab Runner synchronization failed\n");
  process.exitCode = 1;
});
