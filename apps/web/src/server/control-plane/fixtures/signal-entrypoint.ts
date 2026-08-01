import { setTimeout as delay } from "node:timers/promises";

import {
  installShutdownSignalHandlers,
  runControlPlaneEntrypoint,
} from "../entrypoint";

const controller = new AbortController();
installShutdownSignalHandlers(process, controller);

process.stdout.write("ready\n");
runControlPlaneEntrypoint(async () => {
  if (!controller.signal.aborted) {
    await new Promise<void>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }
  await delay(100);
}, process).catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : "fixture failed\n");
  process.exitCode = 1;
});
