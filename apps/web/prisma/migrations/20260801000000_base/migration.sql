-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "platform_role" AS ENUM ('viewer', 'operator', 'administrator', 'auditor');

-- CreateEnum
CREATE TYPE "observation_source" AS ENUM ('host_agent', 'gitlab');

-- CreateEnum
CREATE TYPE "operation_type" AS ENUM ('provision_project_runner');

-- CreateEnum
CREATE TYPE "operation_state" AS ENUM ('requested', 'authorized', 'dispatched', 'running', 'succeeded', 'failed', 'partially_failed', 'unknown', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "provisioning_stage" AS ENUM ('authorization', 'gitlab_runner_creation', 'host_preparation', 'runner_registration', 'verification', 'first_observation');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "external_subject" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "platform_role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runner_hosts" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "enrolled_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runner_hosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_credentials" (
    "id" TEXT NOT NULL,
    "runner_host_id" TEXT NOT NULL,
    "runner_stack_id" TEXT,
    "token_digest" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "agent_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runner_stacks" (
    "id" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "workload" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "template_revision_id" TEXT,
    "decommissioned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runner_stacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gitlab_project_refs" (
    "id" TEXT NOT NULL,
    "gitlab_project_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gitlab_project_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runner_templates" (
    "id" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "workload" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runner_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runner_template_revisions" (
    "id" TEXT NOT NULL,
    "runner_template_id" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL,
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runner_template_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" TEXT NOT NULL,
    "type" "operation_type" NOT NULL,
    "state" "operation_state" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "gitlab_project_ref_id" TEXT NOT NULL,
    "runner_template_revision_id" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "redacted_outcome" JSONB,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_events" (
    "id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "state" "operation_state" NOT NULL,
    "stage" "provisioning_stage",
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runner_record_refs" (
    "id" TEXT NOT NULL,
    "runner_stack_id" TEXT NOT NULL,
    "gitlab_runner_id" TEXT NOT NULL,
    "project_path" TEXT NOT NULL,

    CONSTRAINT "runner_record_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" TEXT NOT NULL,
    "runner_stack_id" TEXT NOT NULL,
    "source" "observation_source" NOT NULL,
    "delivery_id" TEXT,
    "delivery_digest" TEXT,
    "schema_version" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_external_subject_key" ON "users"("external_subject");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_user_id_role_key" ON "role_assignments"("user_id", "role");

-- CreateIndex
CREATE INDEX "agent_credentials_runner_host_id_idx" ON "agent_credentials"("runner_host_id");

-- CreateIndex
CREATE INDEX "agent_credentials_runner_stack_id_idx" ON "agent_credentials"("runner_stack_id");

-- CreateIndex
CREATE INDEX "runner_stacks_host_id_canonical_name_idx" ON "runner_stacks"("host_id", "canonical_name");

-- CreateIndex
CREATE INDEX "runner_stacks_decommissioned_at_idx" ON "runner_stacks"("decommissioned_at");

-- CreateIndex
CREATE INDEX "runner_stacks_template_revision_id_idx" ON "runner_stacks"("template_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "gitlab_project_refs_gitlab_project_id_key" ON "gitlab_project_refs"("gitlab_project_id");

-- CreateIndex
CREATE UNIQUE INDEX "gitlab_project_refs_path_key" ON "gitlab_project_refs"("path");

-- CreateIndex
CREATE UNIQUE INDEX "runner_templates_canonical_name_key" ON "runner_templates"("canonical_name");

-- CreateIndex
CREATE INDEX "runner_template_revisions_retired_at_idx" ON "runner_template_revisions"("retired_at");

-- CreateIndex
CREATE UNIQUE INDEX "runner_template_revisions_runner_template_id_revision_key" ON "runner_template_revisions"("runner_template_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "operations_idempotency_key_key" ON "operations"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "operations_correlation_id_key" ON "operations"("correlation_id");

-- CreateIndex
CREATE INDEX "operations_state_available_at_idx" ON "operations"("state", "available_at");

-- CreateIndex
CREATE INDEX "operations_gitlab_project_ref_id_idx" ON "operations"("gitlab_project_ref_id");

-- CreateIndex
CREATE INDEX "operations_runner_template_revision_id_idx" ON "operations"("runner_template_revision_id");

-- CreateIndex
CREATE INDEX "operation_events_occurred_at_idx" ON "operation_events"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "operation_events_operation_id_sequence_key" ON "operation_events"("operation_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "runner_record_refs_runner_stack_id_key" ON "runner_record_refs"("runner_stack_id");

-- CreateIndex
CREATE UNIQUE INDEX "runner_record_refs_gitlab_runner_id_key" ON "runner_record_refs"("gitlab_runner_id");

-- CreateIndex
CREATE INDEX "observations_runner_stack_id_source_observed_at_idx" ON "observations"("runner_stack_id", "source", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "observations_runner_stack_id_source_delivery_id_key" ON "observations"("runner_stack_id", "source", "delivery_id");

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_correlation_id_idx" ON "audit_events"("correlation_id");

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_runner_host_id_fkey" FOREIGN KEY ("runner_host_id") REFERENCES "runner_hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_runner_stack_id_fkey" FOREIGN KEY ("runner_stack_id") REFERENCES "runner_stacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runner_stacks" ADD CONSTRAINT "runner_stacks_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "runner_hosts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runner_stacks" ADD CONSTRAINT "runner_stacks_template_revision_id_fkey" FOREIGN KEY ("template_revision_id") REFERENCES "runner_template_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runner_template_revisions" ADD CONSTRAINT "runner_template_revisions_runner_template_id_fkey" FOREIGN KEY ("runner_template_id") REFERENCES "runner_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_gitlab_project_ref_id_fkey" FOREIGN KEY ("gitlab_project_ref_id") REFERENCES "gitlab_project_refs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_runner_template_revision_id_fkey" FOREIGN KEY ("runner_template_revision_id") REFERENCES "runner_template_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runner_record_refs" ADD CONSTRAINT "runner_record_refs_runner_stack_id_fkey" FOREIGN KEY ("runner_stack_id") REFERENCES "runner_stacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_runner_stack_id_fkey" FOREIGN KEY ("runner_stack_id") REFERENCES "runner_stacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SeedData
INSERT INTO "runner_templates" ("id", "canonical_name", "workload", "created_at", "updated_at") VALUES
    ('template_gitlab_runners_frontend', 'gitlab-runners/frontend', 'frontend', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('template_gitlab_runners_dotnet', 'gitlab-runners/dotnet', 'dotnet', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "runner_template_revisions" (
    "id",
    "runner_template_id",
    "revision",
    "policy",
    "approved_at"
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
