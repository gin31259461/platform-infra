import {
  AgentBootstrapFinalizationError,
  bootstrapAgent,
} from "../src/server/agent/credential-bootstrap";
import { installHostAgent } from "../src/server/agent/installer";
import { getPrismaClient } from "../src/server/database/client";

const allowedOptions = new Set(["control-plane-url", "stack", "stack-id"]);

function parseOptions(values: string[]): {
  canonicalStackName: string;
  controlPlaneUrl: string;
  runnerStackId?: string;
} {
  values = values[0] === "--" ? values.slice(1) : values;
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
    runnerStackId: options.get("stack-id"),
  };
}

async function main(): Promise<void> {
  const input = parseOptions(process.argv.slice(2));
  const prisma = getPrismaClient();
  try {
    const result = await bootstrapAgent(prisma, input, installHostAgent);
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
