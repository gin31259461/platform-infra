import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runControlPlaneEntrypoint } from "./entrypoint";

describe("Control Plane entrypoint", () => {
  it("normalizes an inherited SIGINT status after an orderly shutdown", async () => {
    const processState = { exitCode: 130 };

    await runControlPlaneEntrypoint(async () => undefined, processState);

    expect(processState.exitCode).toBe(0);
  });

  it("survives pnpm-style duplicate SIGINT delivery during shutdown", async () => {
    const fixturePath = fileURLToPath(new URL("./fixtures/signal-entrypoint.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", fixturePath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const exit = once(child, "exit");
    const lines = createInterface({ input: child.stdout });
    try {
      await Promise.race([
        once(lines, "line").then(([line]) => {
          if (line !== "ready") throw new Error(`unexpected fixture output: ${String(line)}`);
        }),
        exit.then(([code, signal]) => {
          throw new Error(`fixture exited before ready: code=${String(code)} signal=${String(signal)}`);
        }),
      ]);

      child.kill("SIGINT");
      await new Promise((resolve) => setTimeout(resolve, 20));
      child.kill("SIGINT");

      const [code, signal] = await exit;
      expect({ code, signal, stderr: Buffer.concat(stderr).toString() }).toEqual({
        code: 0,
        signal: null,
        stderr: "",
      });
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });
});
