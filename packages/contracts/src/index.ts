import { z } from "zod";

export const contractVersion = "1.0" as const;

export const canonicalStackNameSchema = z.string().regex(
  /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/,
  "Stack name must be a canonical type/workload name",
);

export const healthStateSchema = z.enum([
  "healthy",
  "degraded",
  "unhealthy",
  "unknown",
  "maintenance",
]);

const secretPattern = /(glrt-|glpat-|gldt-|authorization\s*:\s*bearer|-----begin [^-]*private key-----)/i;

export const safeDiagnosticTextSchema = z.string()
  .min(1)
  .max(240)
  .refine((value) => !secretPattern.test(value), "Diagnostic text contains a token-shaped value");

export const checkObservationSchema = z.object({
  key: z.enum([
    "vpn",
    "dns",
    "tls",
    "systemd-user",
    "podman-socket",
    "runner-manager",
    "runner-config",
    "gitlab-connectivity",
  ]),
  state: healthStateSchema.exclude(["maintenance"]),
  summary: safeDiagnosticTextSchema,
}).strict();

export const driftFindingSchema = z.object({
  field: z.string().min(1).max(120),
  summary: safeDiagnosticTextSchema,
  reconcilable: z.boolean(),
}).strict();

export const hostAgentStackObservationSchema = z.object({
  id: z.string().min(1).max(120),
  stackName: canonicalStackNameSchema,
  workload: z.enum(["frontend", "dotnet"]),
  runnerVersion: z.string().min(1).max(40).nullable(),
  tags: z.array(z.string().min(1).max(80)).max(20),
  jobsRunning: z.number().int().nonnegative().nullable(),
  checks: z.array(checkObservationSchema).min(1).max(20),
  drift: z.array(driftFindingSchema).max(50).nullable(),
}).strict();

export const hostAgentObservationSchema = z.object({
  contractVersion: z.literal(contractVersion),
  deliveryId: z.uuid(),
  hostId: z.string().min(1).max(120),
  observedAt: z.iso.datetime(),
  agentVersion: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/),
  stacks: z.array(hostAgentStackObservationSchema).min(1).max(50),
}).strict().superRefine((observation, context) => {
  const stackIds = new Set<string>();
  for (const [index, stack] of observation.stacks.entries()) {
    if (stackIds.has(stack.id)) {
      context.addIssue({
        code: "custom",
        message: "Stack IDs must be unique within one delivery",
        path: ["stacks", index, "id"],
      });
    }
    stackIds.add(stack.id);
  }
});

export const gitlabRunnerStateSchema = z.enum([
  "online",
  "offline",
  "stale",
  "never_contacted",
  "paused",
  "unknown",
]);

export const gitlabJobExecutionStatusSchema = z.enum([
  "idle",
  "running",
  "unknown",
]);

export const gitlabRunnerObservationSchema = z.object({
  contractVersion: z.literal(contractVersion),
  runnerRecordId: z.string().min(1).max(120),
  observedAt: z.iso.datetime(),
  state: gitlabRunnerStateSchema,
  contactedAt: z.iso.datetime().nullable(),
  jobExecutionStatus: gitlabJobExecutionStatusSchema,
}).strict();

export const runnerStackObservationSchema = z.object({
  id: z.string().min(1).max(120),
  stackName: canonicalStackNameSchema,
  workload: z.enum(["frontend", "dotnet"]),
  hostId: z.string().min(1).max(120),
  hostDisplayName: z.string().min(1).max(120),
  projectPath: z.string().min(3).max(255).regex(/^[^/]+\/[^/]+$/).nullable(),
  runnerRecordId: z.string().min(1).max(120).nullable(),
  gitlabState: gitlabRunnerStateSchema,
  gitlabContactedAt: z.iso.datetime().nullable(),
  gitlabJobExecutionStatus: gitlabJobExecutionStatusSchema,
  gitlabObservedAt: z.iso.datetime().nullable(),
  observedAt: z.iso.datetime().nullable(),
  runnerVersion: z.string().min(1).max(40).nullable(),
  tags: z.array(z.string().min(1).max(80)).max(20),
  jobsRunning: z.number().int().nonnegative().nullable(),
  checks: z.array(checkObservationSchema).min(1).max(20),
  drift: z.array(driftFindingSchema).max(50).nullable(),
}).strict();

export const fleetSnapshotSchema = z.object({
  contractVersion: z.literal(contractVersion),
  generatedAt: z.iso.datetime(),
  stacks: z.array(runnerStackObservationSchema),
}).strict();

export const roleSchema = z.enum([
  "viewer",
  "operator",
  "administrator",
  "auditor",
]);

export const actorSchema = z.object({
  id: z.string().min(1).max(120),
  displayName: z.string().min(1).max(120),
  roles: z.array(roleSchema).min(1),
}).strict();

export type Actor = z.infer<typeof actorSchema>;
export type CheckObservation = z.infer<typeof checkObservationSchema>;
export type DriftFinding = z.infer<typeof driftFindingSchema>;
export type FleetSnapshot = z.infer<typeof fleetSnapshotSchema>;
export type GitLabJobExecutionStatus = z.infer<typeof gitlabJobExecutionStatusSchema>;
export type GitLabRunnerObservation = z.infer<typeof gitlabRunnerObservationSchema>;
export type GitLabRunnerState = z.infer<typeof gitlabRunnerStateSchema>;
export type HealthState = z.infer<typeof healthStateSchema>;
export type HostAgentObservation = z.infer<typeof hostAgentObservationSchema>;
export type HostAgentStackObservation = z.infer<typeof hostAgentStackObservationSchema>;
export type Role = z.infer<typeof roleSchema>;
export type RunnerStackObservation = z.infer<typeof runnerStackObservationSchema>;
