import type { GitLabSyncResult } from "../gitlab/sync";

export type ManagedWebProcess = {
  stop(): void;
  wait(): Promise<{ code: number | null; signal: string | null }>;
};

type ControlPlaneLifecycleOptions = {
  initialSync: () => Promise<GitLabSyncResult>;
  intervalMs: number;
  onSyncResult: (result: GitLabSyncResult) => void;
  signal: AbortSignal;
  startWeb: () => ManagedWebProcess;
  watch: (options: { initialDelayMs: number; signal: AbortSignal }) => Promise<void>;
};

type LifecycleOutcome =
  | { kind: "aborted" }
  | { error: unknown; kind: "watcher" }
  | { error: unknown; exit: { code: number | null; signal: string | null } | null; kind: "web" };

function initialWatchDelay(result: GitLabSyncResult, intervalMs: number): number {
  return Math.max(intervalMs, (result.retryAfterSeconds ?? 0) * 1_000);
}

function waitForAbort(signal: AbortSignal): Promise<LifecycleOutcome> {
  if (signal.aborted) return Promise.resolve({ kind: "aborted" });
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ kind: "aborted" }), { once: true });
  });
}

export async function runControlPlaneLifecycle(options: ControlPlaneLifecycleOptions): Promise<void> {
  if (options.signal.aborted) return;

  const initialResult = await options.initialSync();
  options.onSyncResult(initialResult);
  if (options.signal.aborted) return;

  const lifecycleController = new AbortController();
  const forwardAbort = () => lifecycleController.abort();
  options.signal.addEventListener("abort", forwardAbort, { once: true });
  const web = options.startWeb();

  const watcherCompletion = options.watch({
    initialDelayMs: initialWatchDelay(initialResult, options.intervalMs),
    signal: lifecycleController.signal,
  }).then<LifecycleOutcome, LifecycleOutcome>(
    () => ({ error: null, kind: "watcher" }),
    (error: unknown) => ({ error, kind: "watcher" }),
  );
  const webCompletion = web.wait().then<LifecycleOutcome, LifecycleOutcome>(
    (exit) => ({ error: null, exit, kind: "web" }),
    (error: unknown) => ({ error, exit: null, kind: "web" }),
  );

  const outcome = await Promise.race([
    watcherCompletion,
    webCompletion,
    waitForAbort(options.signal),
  ]);

  lifecycleController.abort();
  web.stop();
  await Promise.allSettled([watcherCompletion, webCompletion]);
  options.signal.removeEventListener("abort", forwardAbort);

  if (outcome.kind === "watcher" && outcome.error !== null) throw outcome.error;
  if (outcome.kind === "watcher" && !options.signal.aborted) {
    throw new Error("GitLab synchronization watcher stopped unexpectedly");
  }
  if (outcome.kind === "web" && outcome.error !== null) throw outcome.error;
  if (outcome.kind === "web" && !options.signal.aborted) {
    throw new Error("Next.js server stopped unexpectedly");
  }
}
