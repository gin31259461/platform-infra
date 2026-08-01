import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import {
  runControlPlaneLifecycle,
  type ManagedWebProcess,
} from "../src/server/control-plane/lifecycle";
import {
  installShutdownSignalHandlers,
  runControlPlaneEntrypoint,
} from "../src/server/control-plane/entrypoint";
import { GitLabCredentialUnavailableError } from "../src/server/gitlab/credential-store";
import {
  createGitLabObservationRuntime,
  resolveGitLabSyncIntervalMs,
} from "../src/server/gitlab/runtime";
import { watchGitLabRunnerObservations } from "../src/server/gitlab/watcher";

const require = createRequire(import.meta.url);
type NextServerMode = "development" | "production";

function resolveNextServerMode(values: string[]): NextServerMode {
  if (values.length === 0) return "production";
  if (values.length === 1 && values[0] === "--dev") return "development";
  throw new Error("Control Plane start accepts only --dev");
}

function startNextServer(mode: NextServerMode): ManagedWebProcess {
  const nextArguments = mode === "development"
    ? ["dev", "--turbopack", "--hostname", "127.0.0.1"]
    : ["start", "--hostname", "127.0.0.1"];
  const child = spawn(process.execPath, [
    require.resolve("next/dist/bin/next"),
    ...nextArguments,
  ], {
    env: {
      ...process.env,
      PLATFORM_CONTROL_PLANE_STARTED_AT: new Date().toISOString(),
    },
    stdio: "inherit",
  });
  const completion = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  return {
    stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    },
    wait: () => completion,
  };
}

async function main(): Promise<void> {
  const mode = resolveNextServerMode(process.argv.slice(2));
  const controller = new AbortController();
  installShutdownSignalHandlers(process, controller);

  const runtime = await createGitLabObservationRuntime();
  const intervalMs = resolveGitLabSyncIntervalMs();
  try {
    await runControlPlaneLifecycle({
      initialSync: runtime.sync,
      intervalMs,
      onSyncResult: (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
      signal: controller.signal,
      startWeb: () => startNextServer(mode),
      watch: ({ initialDelayMs, signal }) => watchGitLabRunnerObservations({
        initialDelayMs,
        intervalMs,
        onResult: (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
        signal,
        sync: runtime.sync,
      }),
    });
  } finally {
    await runtime.disconnect();
  }
}

runControlPlaneEntrypoint(main, process).catch((error: unknown) => {
  process.stderr.write(error instanceof GitLabCredentialUnavailableError
    ? "Monitoring GitLab credential unavailable; run gitlab:credential:install\n"
    : "Control Plane startup failed\n");
  process.exitCode = 1;
});
