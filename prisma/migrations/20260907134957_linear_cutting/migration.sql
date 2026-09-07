-- AlterTable
ALTER TABLE "CuttingPlan" DROP COLUMN "sheetSizeLabel",
DROP COLUMN "sheetsUsed",
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'sheet',
ADD COLUMN     "stockSizeLabel" TEXT NOT NULL,
ADD COLUMN     "stockUnitsUsed" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "LinearCut" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "label" TEXT,
    "lengthMm" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinearCut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinearCut_projectId_materialId_idx" ON "LinearCut"("projectId", "materialId");

-- AddForeignKey
ALTER TABLE "LinearCut" ADD CONSTRAINT "LinearCut_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinearCut" ADD CONSTRAINT "LinearCut_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

