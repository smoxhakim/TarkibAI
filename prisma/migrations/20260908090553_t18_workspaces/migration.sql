-- Workspaces become the owner of everything a business owns.
--
-- Written by hand rather than generated, because the generated version would
-- ADD COLUMN ... NOT NULL with no default onto tables that already have rows,
-- and would drop CostSettings.userId / QuoteSettings.userId without moving what
-- they pointed at. Every existing row must end up in the personal workspace of
-- the user who owned it, so that nothing changes hands.
--
-- The order matters: create the tables, give every user a workspace and an
-- owner membership, backfill the pointers while they are still nullable, and
-- only then make them NOT NULL and add the constraints.

-- ---------------------------------------------------------------------------
-- 1. New tables
-- ---------------------------------------------------------------------------

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'worker',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'worker',
    "token" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 2. One personal workspace per existing user, and an owner membership in it
-- ---------------------------------------------------------------------------

-- The id is derived from the user id so the two INSERTs below agree without a
-- temporary table, and so re-running against a partially migrated database is
-- not possible by accident (the primary key would collide).
INSERT INTO "Workspace" ("id", "name", "personal", "createdAt", "updatedAt")
SELECT
    'ws-' || "id",
    COALESCE(NULLIF(TRIM("companyName"), ''), NULLIF(TRIM("name"), ''), split_part("email", '@', 1)),
    true,
    "createdAt",
    CURRENT_TIMESTAMP
FROM "User";

INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT 'wm-' || "id", 'ws-' || "id", "id", 'owner', "createdAt"
FROM "User";

-- ---------------------------------------------------------------------------
-- 3. Backfill the pointers while they are still nullable
-- ---------------------------------------------------------------------------

ALTER TABLE "Project" ADD COLUMN "workspaceId" TEXT;
UPDATE "Project" SET "workspaceId" = 'ws-' || "userId";
ALTER TABLE "Project" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "Material" ADD COLUMN "workspaceId" TEXT;
UPDATE "Material" SET "workspaceId" = 'ws-' || "userId";
ALTER TABLE "Material" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CostSettings" ADD COLUMN "workspaceId" TEXT;
UPDATE "CostSettings" SET "workspaceId" = 'ws-' || "userId";
ALTER TABLE "CostSettings" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "QuoteSettings" ADD COLUMN "workspaceId" TEXT;
UPDATE "QuoteSettings" SET "workspaceId" = 'ws-' || "userId";
ALTER TABLE "QuoteSettings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- Settings are the business's now, so the per-person link goes. Project and
-- Material keep userId as the creator; it is no longer read for authorization.
ALTER TABLE "CostSettings" DROP CONSTRAINT "CostSettings_userId_fkey";
DROP INDEX "CostSettings_userId_key";
ALTER TABLE "CostSettings" DROP COLUMN "userId";

ALTER TABLE "QuoteSettings" DROP CONSTRAINT "QuoteSettings_userId_fkey";
DROP INDEX "QuoteSettings_userId_key";
ALTER TABLE "QuoteSettings" DROP COLUMN "userId";

-- ---------------------------------------------------------------------------
-- 4. Constraints and indexes
-- ---------------------------------------------------------------------------

CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE UNIQUE INDEX "WorkspaceInvitation_token_key" ON "WorkspaceInvitation"("token");
CREATE INDEX "WorkspaceInvitation_workspaceId_createdAt_idx" ON "WorkspaceInvitation"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "WorkspaceInvitation_workspaceId_email_key" ON "WorkspaceInvitation"("workspaceId", "email");
CREATE UNIQUE INDEX "CostSettings_workspaceId_key" ON "CostSettings"("workspaceId");
CREATE UNIQUE INDEX "QuoteSettings_workspaceId_key" ON "QuoteSettings"("workspaceId");

ALTER TABLE "CostSettings" ADD CONSTRAINT "CostSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteSettings" ADD CONSTRAINT "QuoteSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Material" ADD CONSTRAINT "Material_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
