ALTER TABLE "AgentCredential"
    ADD COLUMN "runnerStackId" TEXT;

UPDATE "AgentCredential" AS credential
SET "runnerStackId" = candidate."id"
FROM "RunnerStack" AS candidate
WHERE candidate."hostId" = credential."runnerHostId"
  AND (
      SELECT COUNT(*)
      FROM "RunnerStack" AS host_stack
      WHERE host_stack."hostId" = credential."runnerHostId"
  ) = 1;

CREATE INDEX "AgentCredential_runnerStackId_idx" ON "AgentCredential"("runnerStackId");

ALTER TABLE "AgentCredential" ADD CONSTRAINT "AgentCredential_runnerStackId_fkey"
    FOREIGN KEY ("runnerStackId") REFERENCES "RunnerStack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
