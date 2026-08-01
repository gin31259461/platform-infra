import { z } from "zod";

import { getPrismaClient } from "../src/server/database/client";
import { loadGitLabCredential } from "../src/server/gitlab/credential-store";
import { RestGitLabProjectRunnerProvisioner } from "../src/server/gitlab/provisioning-client";
import { LocalHostProvisioner } from "../src/server/provisioning/local-host-provisioner";
import { PrismaProvisioningWorkerStore } from "../src/server/provisioning/prisma-worker-store";
import { ProvisioningWorker } from "../src/server/provisioning/worker";

function parseOperationId(values: string[]): string {
  values = values[0] === "--" ? values.slice(1) : values;
  if (values.length !== 2 || values[0] !== "--operation-id") {
    throw new Error("Usage: --operation-id <uuid>");
  }
  return z.uuid().parse(values[1]);
}

async function main(): Promise<void> {
  const operationId = parseOperationId(process.argv.slice(2));
  const baseUrl = process.env.GITLAB_BASE_URL;
  if (!baseUrl) throw new Error("GITLAB_BASE_URL is required");
  const token = await loadGitLabCredential("provisioning");
  const prisma = getPrismaClient();
  try {
    const worker = new ProvisioningWorker({
      gitlab: new RestGitLabProjectRunnerProvisioner({ baseUrl, token }),
      host: new LocalHostProvisioner(prisma),
      leaseMs: 300_000,
      store: new PrismaProvisioningWorkerStore(prisma),
      workerId: `provisioning-cli-${process.pid}`,
    });
    const result = await worker.runOnce(new Date(), operationId);
    if (result.operationId !== operationId) {
      throw new Error("Requested Provisioning Operation is not available to run");
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.state !== "succeeded") process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Provisioning worker failed"}\n`);
  process.exitCode = 1;
});
