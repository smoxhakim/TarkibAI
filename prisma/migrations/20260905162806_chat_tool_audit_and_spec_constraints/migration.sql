-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "toolCalls" JSONB;

-- CreateIndex
CREATE INDEX "ChatMessage_projectId_createdAt_idx" ON "ChatMessage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectSpec_projectId_createdAt_idx" ON "ProjectSpec"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSpec_projectId_version_key" ON "ProjectSpec"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectVersion_projectId_versionNumber_key" ON "ProjectVersion"("projectId", "versionNumber");

