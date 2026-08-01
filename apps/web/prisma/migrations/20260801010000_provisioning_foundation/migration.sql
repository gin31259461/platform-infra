CREATE TYPE "OperationType" AS ENUM ('PROVISION_PROJECT_RUNNER');
CREATE TYPE "OperationState" AS ENUM (
    'REQUESTED',
    'AUTHORIZED',
    'DISPATCHED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'PARTIALLY_FAILED',
    'UNKNOWN',
    'CANCELLED',
    'EXPIRED'
);
CREATE TYPE "ProvisioningStage" AS ENUM (
    'AUTHORIZATION',
    'GITLAB_RUNNER_CREATION',
    'HOST_PREPARATION',
    'RUNNER_REGISTRATION',
    'VERIFICATION',
    'FIRST_OBSERVATION'
);

CREATE TABLE "GitLabProjectRef" (
    "id" TEXT NOT NULL,
    "gitlabProjectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GitLabProjectRef_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RunnerTemplate" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "workload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunnerTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RunnerTemplateRevision" (
    "id" TEXT NOT NULL,
    "runnerTemplateId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunnerTemplateRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Operation" (
    "id" TEXT NOT NULL,
    "type" "OperationType" NOT NULL,
    "state" "OperationState" NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "gitlabProjectRefId" TEXT NOT NULL,
    "runnerTemplateRevisionId" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "redactedOutcome" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationEvent" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "state" "OperationState" NOT NULL,
    "stage" "ProvisioningStage",
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RunnerStack" ADD COLUMN "templateRevisionId" TEXT;

INSERT INTO "RunnerTemplate" ("id", "canonicalName", "workload", "createdAt", "updatedAt") VALUES
    ('template_gitlab_runners_frontend', 'gitlab-runners/frontend', 'frontend', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('template_gitlab_runners_dotnet', 'gitlab-runners/dotnet', 'dotnet', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "RunnerTemplateRevision" (
    "id",
    "runnerTemplateId",
    "revision",
    "policy",
    "approvedAt"
) VALUES
    (
        'template_revision_gitlab_runners_frontend_v1',
        'template_gitlab_runners_frontend',
        'policy-v1',
        '{"concurrency":1,"jobNetworkPerBuild":true,"jobVolumes":["/cache"],"managerNetwork":"host","privileged":false,"scope":"project","tags":["frontend","podman"]}'::jsonb,
        CURRENT_TIMESTAMP
    ),
    (
        'template_revision_gitlab_runners_dotnet_v1',
        'template_gitlab_runners_dotnet',
        'policy-v1',
        '{"concurrency":1,"jobNetworkPerBuild":true,"jobVolumes":["/cache"],"managerNetwork":"host","privileged":false,"scope":"project","tags":["dotnet","podman"]}'::jsonb,
        CURRENT_TIMESTAMP
    );

CREATE UNIQUE INDEX "GitLabProjectRef_gitlabProjectId_key" ON "GitLabProjectRef"("gitlabProjectId");
CREATE UNIQUE INDEX "GitLabProjectRef_path_key" ON "GitLabProjectRef"("path");
CREATE UNIQUE INDEX "RunnerTemplate_canonicalName_key" ON "RunnerTemplate"("canonicalName");
CREATE UNIQUE INDEX "RunnerTemplateRevision_runnerTemplateId_revision_key"
    ON "RunnerTemplateRevision"("runnerTemplateId", "revision");
CREATE INDEX "RunnerTemplateRevision_retiredAt_idx" ON "RunnerTemplateRevision"("retiredAt");
CREATE UNIQUE INDEX "Operation_idempotencyKey_key" ON "Operation"("idempotencyKey");
CREATE UNIQUE INDEX "Operation_correlationId_key" ON "Operation"("correlationId");
CREATE INDEX "Operation_state_availableAt_idx" ON "Operation"("state", "availableAt");
CREATE INDEX "Operation_gitlabProjectRefId_idx" ON "Operation"("gitlabProjectRefId");
CREATE INDEX "Operation_runnerTemplateRevisionId_idx" ON "Operation"("runnerTemplateRevisionId");
CREATE UNIQUE INDEX "OperationEvent_operationId_sequence_key" ON "OperationEvent"("operationId", "sequence");
CREATE INDEX "OperationEvent_occurredAt_idx" ON "OperationEvent"("occurredAt");
CREATE INDEX "RunnerStack_templateRevisionId_idx" ON "RunnerStack"("templateRevisionId");

ALTER TABLE "RunnerStack" ADD CONSTRAINT "RunnerStack_templateRevisionId_fkey"
    FOREIGN KEY ("templateRevisionId") REFERENCES "RunnerTemplateRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RunnerTemplateRevision" ADD CONSTRAINT "RunnerTemplateRevision_runnerTemplateId_fkey"
    FOREIGN KEY ("runnerTemplateId") REFERENCES "RunnerTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_gitlabProjectRefId_fkey"
    FOREIGN KEY ("gitlabProjectRefId") REFERENCES "GitLabProjectRef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_runnerTemplateRevisionId_fkey"
    FOREIGN KEY ("runnerTemplateRevisionId") REFERENCES "RunnerTemplateRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationEvent" ADD CONSTRAINT "OperationEvent_operationId_fkey"
    FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
