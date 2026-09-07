-- AlterTable
ALTER TABLE "CuttingPlan" DROP COLUMN "diagramImageUrl",
ADD COLUMN     "diagramObjectKey" TEXT,
ADD COLUMN     "edgeMarginMm" INTEGER NOT NULL,
ADD COLUMN     "kerfMm" INTEGER NOT NULL,
ADD COLUMN     "sheetsUsed" INTEGER NOT NULL,
ADD COLUMN     "unplacedCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CuttingPiece" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "label" TEXT,
    "widthMm" INTEGER NOT NULL,
    "heightMm" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "allowRotation" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuttingPiece_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CuttingPiece_projectId_materialId_idx" ON "CuttingPiece"("projectId", "materialId");

-- CreateIndex
CREATE INDEX "CuttingPlan_projectId_idx" ON "CuttingPlan"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CuttingPlan_projectId_materialId_key" ON "CuttingPlan"("projectId", "materialId");

-- AddForeignKey
ALTER TABLE "CuttingPiece" ADD CONSTRAINT "CuttingPiece_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuttingPiece" ADD CONSTRAINT "CuttingPiece_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

