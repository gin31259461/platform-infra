import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  AgentBootstrapFinalizationError,
  bootstrapAgent,
  type AgentInstallerInput,
} from "../src/server/agent/credential-bootstrap";
import { getPrismaClient } from "../src/server/database/client";

const allowedOptions = new Set(["control-plane-url", "stack"]);

function parseOptions(values: string[]): { canonicalStackName: string; controlPlaneUrl: string } {
  const options = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("Options must use --name value pairs");
    }
    const name = flag.slice(2);
    if (!allowedOptions.has(name) || options.has(name)) {
      throw new Error(`Unsupported or duplicate option: ${flag}`);
    }
    options.set(name, value);
  }
  if (!options.has("stack")) throw new Error("Missing required option: --stack");
  return {
    canonicalStackName: options.get("stack")!,
    controlPlaneUrl: options.get("control-plane-url") ?? "http://127.0.0.1:3000",
  };
}

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const installerPath = fileURLToPath(new URL("../../../scripts/install-agent.sh", import.meta.url));

function runInstaller(input: AgentInstallerInput): Promise<void> {
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
    const child = spawn(installerPath, [], {
      cwd: projectRoot,
      env: childEnvironment,
      stdio: ["pipe", "inherit", "inherit"] as const,
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(secret, () => secret.fill(0));
    child.once("error", reject);
    child.once("close", (code) => {
      secret.fill(0);
      if (code === 0) resolve();
      else reject(new Error("Host Agent installer exited unsuccessfully"));
    });
  });
}

async function main(): Promise<void> {
  const input = parseOptions(process.argv.slice(2));
  const prisma = getPrismaClient();
  try {
    const result = await bootstrapAgent(prisma, input, runInstaller);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  if (error instanceof AgentBootstrapFinalizationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write("Host Agent bootstrap failed\n");
  }
  process.exitCode = 1;
});
