-- CreateTable
CREATE TABLE "DesignProposal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "commands" JSONB NOT NULL,
    "specPatch" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "DesignProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignProposal_projectId_createdAt_idx" ON "DesignProposal"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignProposal_projectId_status_idx" ON "DesignProposal"("projectId", "status");

-- AddForeignKey
ALTER TABLE "DesignProposal" ADD CONSTRAINT "DesignProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

