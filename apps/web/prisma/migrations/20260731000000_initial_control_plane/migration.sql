CREATE TYPE "PlatformRole" AS ENUM ('VIEWER', 'OPERATOR', 'ADMINISTRATOR', 'AUDITOR');
CREATE TYPE "ObservationSource" AS ENUM ('HOST_AGENT', 'GITLAB');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "externalSubject" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RunnerHost" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunnerHost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RunnerStack" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "workload" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunnerStack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RunnerRecordRef" (
    "id" TEXT NOT NULL,
    "runnerStackId" TEXT NOT NULL,
    "gitlabRunnerId" TEXT NOT NULL,
    "projectPath" TEXT NOT NULL,
    CONSTRAINT "RunnerRecordRef_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "runnerStackId" TEXT NOT NULL,
    "source" "ObservationSource" NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_externalSubject_key" ON "User"("externalSubject");
CREATE UNIQUE INDEX "RoleAssignment_userId_role_key" ON "RoleAssignment"("userId", "role");
CREATE UNIQUE INDEX "RunnerStack_hostId_canonicalName_key" ON "RunnerStack"("hostId", "canonicalName");
CREATE UNIQUE INDEX "RunnerRecordRef_runnerStackId_key" ON "RunnerRecordRef"("runnerStackId");
CREATE UNIQUE INDEX "RunnerRecordRef_gitlabRunnerId_key" ON "RunnerRecordRef"("gitlabRunnerId");
CREATE INDEX "Observation_runnerStackId_source_observedAt_idx" ON "Observation"("runnerStackId", "source", "observedAt");
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunnerStack" ADD CONSTRAINT "RunnerStack_hostId_fkey"
    FOREIGN KEY ("hostId") REFERENCES "RunnerHost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RunnerRecordRef" ADD CONSTRAINT "RunnerRecordRef_runnerStackId_fkey"
    FOREIGN KEY ("runnerStackId") REFERENCES "RunnerStack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_runnerStackId_fkey"
    FOREIGN KEY ("runnerStackId") REFERENCES "RunnerStack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
