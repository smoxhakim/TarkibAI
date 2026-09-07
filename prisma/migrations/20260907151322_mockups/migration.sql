-- AlterTable
ALTER TABLE "Mockup" DROP COLUMN "resultImageUrl",
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'concept',
ADD COLUMN     "model" TEXT,
ADD COLUMN     "promptSource" JSONB,
ADD COLUMN     "resultObjectKey" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'queued';

-- CreateIndex
CREATE INDEX "Mockup_projectId_createdAt_idx" ON "Mockup"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Mockup_status_idx" ON "Mockup"("status");

