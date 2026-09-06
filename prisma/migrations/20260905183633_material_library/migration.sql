-- AlterTable
ALTER TABLE "Material" DROP COLUMN "standardUnitSize",
DROP COLUMN "thickness",
DROP COLUMN "unit",
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "measurementModel" TEXT NOT NULL,
ADD COLUMN     "sheetHeightMm" INTEGER,
ADD COLUMN     "sheetWidthMm" INTEGER,
ADD COLUMN     "standardLengthMm" INTEGER,
ADD COLUMN     "technicalProperties" JSONB,
ADD COLUMN     "thicknessMm" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "ProjectMaterial" ADD COLUMN     "calculatedAt" TIMESTAMP(3),
ADD COLUMN     "role" TEXT,
ALTER COLUMN "requiredQuantity" DROP NOT NULL,
ALTER COLUMN "requiredDimensions" DROP NOT NULL,
ALTER COLUMN "unitsToPurchase" DROP NOT NULL,
ALTER COLUMN "totalPurchasedQuantity" DROP NOT NULL,
ALTER COLUMN "wastePercent" DROP NOT NULL,
ALTER COLUMN "unitPriceCentsSnapshot" DROP NOT NULL,
ALTER COLUMN "totalCostCents" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Material_userId_archivedAt_idx" ON "Material"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "Material_userId_category_idx" ON "Material"("userId", "category");

-- CreateIndex
CREATE INDEX "ProjectMaterial_projectId_idx" ON "ProjectMaterial"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMaterial_projectId_materialId_key" ON "ProjectMaterial"("projectId", "materialId");

