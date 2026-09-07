-- AlterTable
ALTER TABLE "Diagram" DROP COLUMN "dimensionsData",
DROP COLUMN "imageUrl",
DROP COLUMN "type",
ADD COLUMN     "imageObjectKey" TEXT,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "sourceSnapshot" JSONB NOT NULL,
ADD COLUMN     "svg" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL,
ADD COLUMN     "views" JSONB NOT NULL;

-- CreateIndex
CREATE INDEX "Diagram_projectId_createdAt_idx" ON "Diagram"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Diagram_projectId_version_key" ON "Diagram"("projectId", "version");

