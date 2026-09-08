import { prisma } from '@/lib/db';
import { ApiError, badRequest } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import type { ProjectSpec } from '@/generated/prisma/client';
import { missingFields, type SpecFieldKey } from './completeness';
import { mergeSpec } from './merge';
import { recordVersion } from '@/lib/versions/service';
import { recordAudit } from '@/lib/audit/service';
import { emptySpec, parseSpecData, type ProjectSpecData, type ProjectSpecPatch } from './schema';

export type SpecView = {
  spec: ProjectSpecData;
  version: number;
  status: 'draft' | 'approved';
  approvedAt: Date | null;
  missing: SpecFieldKey[];
  complete: boolean;
};

function toView(row: ProjectSpec | null): SpecView {
  const spec = row ? parseSpecData(row.data) : emptySpec();
  const missing = missingFields(spec);
  return {
    spec,
    version: row?.version ?? 0,
    status: (row?.status as 'draft' | 'approved') ?? 'draft',
    approvedAt: row?.approvedAt ?? null,
    missing,
    complete: missing.length === 0,
  };
}

/** Most recent spec row for a project, or null when the conversation has not produced one. */
async function latestSpecRow(projectId: string) {
  return prisma.projectSpec.findFirst({
    where: { projectId },
    orderBy: { version: 'desc' },
  });
}

export async function getSpec(projectId: string, userId: string): Promise<SpecView> {
  await assertProjectAccess(projectId, userId);
  return toView(await latestSpecRow(projectId));
}

/**
 * Applies a patch to the working draft.
 *
 * If the latest spec is already approved, the patch starts a NEW draft version
 * seeded from it, rather than mutating an approved record. An approved
 * specification is a fixed point that documents and calculations refer back to;
 * editing it in place would silently change what was agreed.
 */
export async function updateDraftSpec(
  projectId: string,
  userId: string,
  patch: ProjectSpecPatch
): Promise<SpecView> {
  await assertProjectAccess(projectId, userId);

  const latest = await latestSpecRow(projectId);
  const current = latest ? parseSpecData(latest.data) : emptySpec();
  const merged = mergeSpec(current, patch);

  if (latest && latest.status === 'draft') {
    const updated = await prisma.projectSpec.update({
      where: { id: latest.id },
      data: { data: merged },
    });
    return toView(updated);
  }

  const created = await prisma.projectSpec.create({
    data: {
      projectId,
      version: (latest?.version ?? 0) + 1,
      data: merged,
      status: 'draft',
    },
  });
  return toView(created);
}

/**
 * Approves the current draft. This is a USER action only.
 *
 * The agent has no tool that reaches this function: consent must be an explicit
 * act in the UI, not something a model infers from the words in a chat message
 * (PRD §5.4). Approval is refused while any required field is missing, so an
 * incomplete project cannot be locked in.
 *
 * On success it snapshots a ProjectVersion, so later documents can name the
 * exact project state that produced them (PRD §21).
 */
export async function approveSpec(projectId: string, userId: string): Promise<SpecView> {
  await assertProjectAccess(projectId, userId);

  const latest = await latestSpecRow(projectId);
  if (!latest) {
    throw badRequest('There is no specification to approve yet. Describe the project first.');
  }
  if (latest.status === 'approved') {
    throw new ApiError(409, 'This specification version is already approved.', 'already_approved');
  }

  const spec = parseSpecData(latest.data);
  const missing = missingFields(spec);
  if (missing.length > 0) {
    throw badRequest(
      `The specification is missing required information: ${missing.join(', ')}. ` +
        'Continue the conversation until these are answered.'
    );
  }

  // One transaction so an approved spec can never exist without its snapshot.
  const approved = await prisma.$transaction(async (tx) => {
    const row = await tx.projectSpec.update({
      where: { id: latest.id },
      data: { status: 'approved', approvedAt: new Date() },
    });

    await tx.project.update({
      where: { id: projectId },
      data: { status: 'spec_approved' },
    });

    // Written inside the same transaction: an approved specification must never
    // exist without the snapshot that records the state it was approved in.
    // The snapshot is taken after the status update so it reflects the approval.
    await recordVersion(
      projectId,
      { reason: 'spec_approved', label: `Specification v${row.version} approved` },
      tx
    );

    return row;
  });

  await recordAudit({
    userId,
    projectId,
    action: 'spec.approved',
    summary: `Approved specification v${approved.version}.`,
    detail: { specVersion: approved.version },
  });

  return toView(approved);
}
