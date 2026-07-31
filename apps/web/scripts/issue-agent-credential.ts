import process from "node:process";

import { issueAgentCredential } from "../src/server/agent/credential-issuance";
import { getPrismaClient } from "../src/server/database/client";
import { readSecretFromStandardInput } from "./lib/secret-input";

const allowedOptions = new Set(["host-id", "stack-id"]);

function parseOptions(values: string[]): { hostId: string; runnerStackId: string } {
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
  for (const name of allowedOptions) {
    if (!options.has(name)) throw new Error(`Missing required option: --${name}`);
  }
  return {
    hostId: options.get("host-id")!,
    runnerStackId: options.get("stack-id")!,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const secret = await readSecretFromStandardInput("Host Agent credential secret");
  const prisma = getPrismaClient();
  try {
    const result = await issueAgentCredential(prisma, { ...options, secret });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write("Host Agent credential issuance failed\n");
  process.exitCode = 1;
});
