type ExitCodeTarget = {
  exitCode?: string | number | null;
};

type SignalTarget = {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
};

export function installShutdownSignalHandlers(
  signalTarget: SignalTarget,
  controller: AbortController,
): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    signalTarget.on(signal, () => controller.abort());
  }
}

export async function runControlPlaneEntrypoint(
  run: () => Promise<void>,
  exitCodeTarget: ExitCodeTarget,
): Promise<void> {
  await run();
  exitCodeTarget.exitCode = 0;
}
