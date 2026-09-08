-- The fabrication trade a project belongs to.
--
-- Defaulted to 'signage', which is what every existing project is. No
-- behaviour changes for them: the signage profile carries exactly the
-- required fields, bounds and vocabulary that were hard-coded before.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "domain" TEXT NOT NULL DEFAULT 'signage';

