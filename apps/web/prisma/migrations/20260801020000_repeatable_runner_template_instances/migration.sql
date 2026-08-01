DROP INDEX "RunnerStack_hostId_canonicalName_key";

CREATE INDEX "RunnerStack_hostId_canonicalName_idx" ON "RunnerStack"("hostId", "canonicalName");
