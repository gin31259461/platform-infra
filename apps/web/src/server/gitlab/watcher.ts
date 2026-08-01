import type { GitLabSyncResult } from "./sync";

type GitLabSyncWatcherOptions = {
  initialDelayMs?: number;
  intervalMs: number;
  onResult: (result: GitLabSyncResult) => void;
  signal: AbortSignal;
  sync: () => Promise<GitLabSyncResult>;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

export function waitForGitLabSync(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timeout);
      resolve();
    };
    const onTimeout = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(onTimeout, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export async function watchGitLabRunnerObservations(options: GitLabSyncWatcherOptions): Promise<void> {
  const wait = options.wait ?? waitForGitLabSync;
  if ((options.initialDelayMs ?? 0) > 0) {
    await wait(options.initialDelayMs ?? 0, options.signal);
  }
  while (!options.signal.aborted) {
    const result = await options.sync();
    options.onResult(result);
    if (options.signal.aborted) break;
    const retryDelayMs = (result.retryAfterSeconds ?? 0) * 1_000;
    await wait(Math.max(options.intervalMs, retryDelayMs), options.signal);
  }
}
