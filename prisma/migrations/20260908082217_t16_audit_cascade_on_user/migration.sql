-- Audit events cascade when their user is deleted.
--
-- The first T16 migration left this as RESTRICT, which made deleting a user
-- impossible once they had done anything. An event has no meaning detached
-- from the person who performed it, and userId is required, so cascade is the
-- correct modelling. The PROJECT link stays SET NULL: an event about a deleted
-- project is exactly the record worth keeping.

-- DropForeignKey
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_userId_fkey";

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

