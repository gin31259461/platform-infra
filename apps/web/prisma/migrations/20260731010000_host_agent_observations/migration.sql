CREATE TABLE "AgentCredential" (
    "id" TEXT NOT NULL,
    "runnerHostId" TEXT NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "AgentCredential_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Observation"
    ADD COLUMN "deliveryId" TEXT,
    ADD COLUMN "deliveryDigest" TEXT;

CREATE INDEX "AgentCredential_runnerHostId_idx" ON "AgentCredential"("runnerHostId");
CREATE UNIQUE INDEX "Observation_runnerStackId_source_deliveryId_key"
    ON "Observation"("runnerStackId", "source", "deliveryId");

ALTER TABLE "AgentCredential" ADD CONSTRAINT "AgentCredential_runnerHostId_fkey"
    FOREIGN KEY ("runnerHostId") REFERENCES "RunnerHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
