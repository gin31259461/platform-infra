import { canonicalStackNameSchema } from "@gitlab-runner-platform/contracts";
import { z } from "zod";

const operationIdSchema = z.uuid();
const workloadSchema = z.enum(["frontend", "dotnet"]);

export type ProvisionedRunnerInstance = {
  canonicalName: `gitlab-runners/${"frontend" | "dotnet"}`;
  containerName: string;
  runnerName: string;
  runnerUser: string;
  serviceName: string;
  stackId: string;
  workload: "frontend" | "dotnet";
};

export function deriveProvisionedRunnerInstance(input: {
  canonicalName: string;
  operationId: string;
  workload: string;
}): ProvisionedRunnerInstance {
  const operationId = operationIdSchema.parse(input.operationId);
  const workload = workloadSchema.parse(input.workload);
  const canonicalName = canonicalStackNameSchema.parse(input.canonicalName);
  const expectedCanonicalName: ProvisionedRunnerInstance["canonicalName"] = `gitlab-runners/${workload}`;
  if (canonicalName !== expectedCanonicalName) {
    throw new Error("Runner Template identity is inconsistent");
  }

  const suffix = operationId.replaceAll("-", "").slice(0, 12);
  const systemIdentity = `glr-${workload}-${suffix}`;
  return {
    canonicalName: expectedCanonicalName,
    containerName: systemIdentity,
    runnerName: `runner-platform-${workload}-${suffix}`,
    runnerUser: systemIdentity,
    serviceName: systemIdentity,
    stackId: `${workload}-${suffix}`,
    workload,
  };
}
