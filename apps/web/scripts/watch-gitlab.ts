import { watchGitLabRunnerObservations } from "../src/server/gitlab/watcher";
import { GitLabCredentialUnavailableError } from "../src/server/gitlab/credential-store";
import {
  createGitLabObservationRuntime,
  resolveGitLabSyncIntervalMs,
} from "../src/server/gitlab/runtime";

async function main(): Promise<void> {
  const runtime = await createGitLabObservationRuntime();
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => controller.abort());
  }

  try {
    await watchGitLabRunnerObservations({
      intervalMs: resolveGitLabSyncIntervalMs(),
      onResult: (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
      signal: controller.signal,
      sync: runtime.sync,
    });
  } finally {
    await runtime.disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof GitLabCredentialUnavailableError
    ? "Monitoring GitLab credential unavailable; run gitlab:credential:install\n"
    : "GitLab Runner synchronization watcher failed\n");
  process.exitCode = 1;
});
