-- Reshapes Document into the production package record.
--
-- `pdfUrl` is dropped in favour of an R2 object key: no stored URLs anywhere in
-- this application, because reads are signed and short-lived. The table has
-- never been written to (verified 0 rows before this migration ran), so the
-- drop loses nothing.

-- AlterTable
ALTER TABLE "Document" DROP COLUMN "pdfUrl",
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "pdfObjectKey" TEXT,
ADD COLUMN     "sourceSnapshot" JSONB,
ALTER COLUMN "type" SET DEFAULT 'production';

-- CreateIndex
CREATE INDEX "Document_projectId_createdAt_idx" ON "Document"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_projectId_type_version_key" ON "Document"("projectId", "type", "version");
