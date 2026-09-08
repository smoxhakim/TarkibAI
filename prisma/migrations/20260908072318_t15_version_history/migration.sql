-- Full project snapshots, and a link from each generated document back to
-- the version it came from. Entirely additive: every new column is
-- nullable or defaulted, and existing versions keep the spec snapshot they
-- already have.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "projectVersionId" TEXT;

-- AlterTable
ALTER TABLE "ProjectVersion" ADD COLUMN     "canvasSnapshot" JSONB,
ADD COLUMN     "materialsSnapshot" JSONB,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "reason" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "referenceSnapshot" JSONB;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "projectVersionId" TEXT;

-- CreateIndex
CREATE INDEX "ProjectVersion_projectId_createdAt_idx" ON "ProjectVersion"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectVersionId_fkey" FOREIGN KEY ("projectVersionId") REFERENCES "ProjectVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_projectVersionId_fkey" FOREIGN KEY ("projectVersionId") REFERENCES "ProjectVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

