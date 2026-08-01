ALTER TABLE "RunnerStack" ADD COLUMN "decommissionedAt" TIMESTAMP(3);

CREATE INDEX "RunnerStack_decommissionedAt_idx" ON "RunnerStack"("decommissionedAt");
