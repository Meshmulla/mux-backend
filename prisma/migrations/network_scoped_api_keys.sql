-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "network" TEXT;

-- CreateIndex
CREATE INDEX "ApiKey_network_idx" ON "ApiKey"("network");
