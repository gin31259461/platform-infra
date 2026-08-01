import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "../../../generated/prisma/client";
import { bootstrapAgent } from "../agent/credential-bootstrap";
import { installHostAgent } from "../agent/installer";
import { deriveProvisionedRunnerInstance } from "./instance";
import type { ClaimedProvisioningOperation, HostProvisioner } from "./worker";

type RegistrationInput = {
  authenticationToken: string;
  canonicalName: string;
  stackId: string;
};

type RegisterRunner = (input: RegistrationInput) => Promise<void>;
type BootstrapHostAgent = (input: {
  canonicalStackName: string;
  runnerStackId: string;
}) => Promise<void>;

const projectRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const registrationScript = fileURLToPath(new URL("../../../../../scripts/register-runner.sh", import.meta.url));

function registerRunner(input: RegistrationInput): Promise<void> {
  return new Promise((resolve, reject) => {
    const secret = Buffer.from(input.authenticationToken, "utf8");
    const child = spawn(registrationScript, [input.canonicalName, input.stackId], {
      cwd: projectRoot,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
      stdio: ["pipe", "inherit", "inherit"] as const,
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(secret, () => secret.fill(0));
    child.once("error", (error) => {
      secret.fill(0);
      reject(error);
    });
    child.once("close", (code: number | null) => {
      secret.fill(0);
      if (code === 0) resolve();
      else reject(new Error("Runner registration exited unsuccessfully"));
    });
  });
}

export class LocalHostProvisioner implements HostProvisioner {
  private readonly bootstrap: BootstrapHostAgent;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly register: RegisterRunner = registerRunner,
    bootstrap?: BootstrapHostAgent,
  ) {
    this.bootstrap = bootstrap ?? (async (input) => {
      await bootstrapAgent(this.prisma, {
        ...input,
        controlPlaneUrl: "http://127.0.0.1:3000",
      }, installHostAgent);
    });
  }

  async provision(input: {
    authenticationToken: string;
    operation: ClaimedProvisioningOperation;
    runnerRecordId: string;
  }): Promise<{ runnerStackId: string }> {
    const instance = deriveProvisionedRunnerInstance({
      canonicalName: input.operation.template.canonicalName,
      operationId: input.operation.id,
      workload: input.operation.template.workload,
    });
    const hosts = await this.prisma.runnerHost.findMany({
      select: { id: true },
      take: 2,
      where: { revokedAt: null },
    });
    if (hosts.length !== 1) throw new Error("Host provisioning requires exactly one active Runner Host");

    const existing = await this.prisma.runnerStack.findUnique({
      include: { runnerRecord: true },
      where: { id: instance.stackId },
    });
    if (existing) {
      if (
        existing.canonicalName !== instance.canonicalName
        || existing.hostId !== hosts[0]!.id
        || existing.runnerRecord?.gitlabRunnerId !== input.runnerRecordId
        || existing.runnerRecord.projectPath !== input.operation.project.path
      ) {
        throw new Error("Provisioned Runner Stack identity conflicts with durable inventory");
      }
      return { runnerStackId: existing.id };
    }

    await this.register({
      authenticationToken: input.authenticationToken,
      canonicalName: instance.canonicalName,
      stackId: instance.stackId,
    });

    await this.prisma.$transaction(async (transaction) => {
      await transaction.runnerStack.create({
        data: {
          canonicalName: instance.canonicalName,
          hostId: hosts[0]!.id,
          id: instance.stackId,
          templateRevisionId: input.operation.template.id,
          workload: instance.workload,
        },
      });
      await transaction.runnerRecordRef.create({
        data: {
          gitlabRunnerId: input.runnerRecordId,
          id: randomUUID(),
          projectPath: input.operation.project.path,
          runnerStackId: instance.stackId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorId: "host-provisioner-cli",
          correlationId: input.operation.correlationId,
          eventType: "runner-stack.provisioned",
          id: randomUUID(),
          payload: {
            operationId: input.operation.id,
            runnerRecordId: input.runnerRecordId,
            templateRevisionId: input.operation.template.id,
          },
          targetId: instance.stackId,
          targetType: "runner-stack",
        },
      });
    });
    await this.bootstrap({
      canonicalStackName: instance.canonicalName,
      runnerStackId: instance.stackId,
    });
    return { runnerStackId: instance.stackId };
  }
}
