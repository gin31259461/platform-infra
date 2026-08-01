import { z } from "zod";

import { getPrismaClient } from "../src/server/database/client";
import { decommissionRunnerStack } from "../src/server/fleet/decommission";

function parseStackId(values: string[]): string {
  const options = values[0] === "--" ? values.slice(1) : values;
  if (options.length !== 2 || options[0] !== "--stack-id") {
    throw new Error("Usage: runner:decommission -- --stack-id <stack-id>");
  }
  return z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/).parse(options[1]);
}

async function main(): Promise<void> {
  const stackId = parseStackId(process.argv.slice(2));
  const prisma = getPrismaClient();
  try {
    const result = await decommissionRunnerStack(prisma, { stackId });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Runner Stack decommission failed"}\n`);
  process.exitCode = 1;
});
