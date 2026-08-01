import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { AgentInstallerInput } from "./credential-bootstrap";

const projectRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const installerPath = fileURLToPath(new URL("../../../../../scripts/install-agent.sh", import.meta.url));

export function installHostAgent(input: AgentInstallerInput): Promise<void> {
  return new Promise((resolve, reject) => {
    const secret = Buffer.from(input.secret, "utf8");
    const childEnvironment: NodeJS.ProcessEnv = {
      ALLOW_PLAINTEXT_LOOPBACK: String(input.allowPlaintextLoopback),
      CONTROL_PLANE_URL: input.controlPlaneUrl,
      CREDENTIAL_ID: input.credentialId,
      HOST_ID: input.hostId,
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      RUNNER_STACK_ID: input.runnerStackId,
      STACK: input.canonicalStackName,
    };
    if (/^(frontend|dotnet)-[a-f0-9]{12}$/.test(input.runnerStackId)) {
      childEnvironment.STACK_INSTANCE_ID = input.runnerStackId;
    }
    const child = spawn(installerPath, [], {
      cwd: projectRoot,
      env: childEnvironment,
      stdio: ["pipe", "inherit", "inherit"] as const,
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(secret, () => secret.fill(0));
    child.once("error", (error) => {
      secret.fill(0);
      reject(error);
    });
    child.once("close", (code) => {
      secret.fill(0);
      if (code === 0) resolve();
      else reject(new Error("Host Agent installer exited unsuccessfully"));
    });
  });
}
