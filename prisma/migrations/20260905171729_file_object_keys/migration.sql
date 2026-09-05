-- AlterTable
ALTER TABLE "File" DROP COLUMN "url",
ADD COLUMN     "objectKey" TEXT NOT NULL,
ADD COLUMN     "originalName" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE UNIQUE INDEX "File_objectKey_key" ON "File"("objectKey");

-- CreateIndex
CREATE INDEX "File_projectId_createdAt_idx" ON "File"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "File_projectId_status_idx" ON "File"("projectId", "status");

