-- AlterTable
ALTER TABLE "ProjectMaterial" ADD COLUMN     "calculationInputs" JSONB,
ADD COLUMN     "specVersionAtCalculation" INTEGER,
ADD COLUMN     "unsupportedReason" TEXT,
ADD COLUMN     "wasteQuantity" DECIMAL(65,30);

