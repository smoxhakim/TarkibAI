-- AlterTable
ALTER TABLE "CostSettings" DROP COLUMN "installValue",
DROP COLUMN "laborValue",
DROP COLUMN "marginPercent",
DROP COLUMN "taxPercent",
DROP COLUMN "transportValue",
ADD COLUMN     "installBp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "installCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "laborBp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "laborCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "marginBp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxBp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "transportBp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "transportCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProjectCost" ADD COLUMN     "clientSubtotalCents" INTEGER NOT NULL,
ADD COLUMN     "materialsCalculatedAt" TIMESTAMP(3),
ADD COLUMN     "otherCostCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "settingsSnapshot" JSONB;

-- CreateTable
CREATE TABLE "ProjectExpense" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectExpense_projectId_idx" ON "ProjectExpense"("projectId");

-- CreateIndex
CREATE INDEX "ProjectCost_projectId_computedAt_idx" ON "ProjectCost"("projectId", "computedAt");

-- AddForeignKey
ALTER TABLE "ProjectExpense" ADD CONSTRAINT "ProjectExpense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

