-- Quote numbering belongs to the business, not to the person who issued it.
--
-- With per-user sequences, two members of one workspace issuing quotes on the
-- same day would both produce Q-2026-0001 and hand two different clients the
-- same reference. Backfilled from each quote's project, so no issued quote
-- changes its number.

ALTER TABLE "Quote" ADD COLUMN "workspaceId" TEXT;

UPDATE "Quote" SET "workspaceId" = (
    SELECT "Project"."workspaceId" FROM "Project" WHERE "Project"."id" = "Quote"."projectId"
);

ALTER TABLE "Quote" ALTER COLUMN "workspaceId" SET NOT NULL;

DROP INDEX "Quote_userId_sequence_key";
DROP INDEX "Quote_userId_number_key";

CREATE UNIQUE INDEX "Quote_workspaceId_sequence_key" ON "Quote"("workspaceId", "sequence");
CREATE UNIQUE INDEX "Quote_workspaceId_number_key" ON "Quote"("workspaceId", "number");

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
