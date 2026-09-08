import { prisma } from '@/lib/db';
import { ApiError, badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess } from '@/lib/projects/service';
import { applyCommands } from '@/lib/canvas/service';
import { recordVersion } from '@/lib/versions/service';
import { recordAudit } from '@/lib/audit/service';
import { sceneCommandSchema, type SceneCommand } from '@/lib/canvas/schema';
import { updateDraftSpec } from '@/lib/spec/service';
import { projectSpecPatchSchema, type ProjectSpecPatch } from '@/lib/spec/schema';

/**
 * Design proposals.
 *
 * The agent can propose a change and nothing else. There is no tool, and no
 * code path reachable from the agent, that mutates the canvas directly — a
 * proposal sits inert until a person approves it (PRD §5.4).
 *
 * Approved and rejected rows are never deleted: together they are the design
 * revision history.
 */
export type ProposalView = {
  id: string;
  summary: string;
  commands: SceneCommand[];
  specPatch: ProjectSpecPatch | null;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  failureReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

/** Reads stored JSON defensively; a malformed row must not break the workspace. */
function readCommands(value: unknown): SceneCommand[] {
  if (!Array.isArray(value)) return [];
  const parsed = value.map((entry) => sceneCommandSchema.safeParse(entry));
  return parsed.filter((r) => r.success).map((r) => r.data);
}

function readSpecPatch(value: unknown): ProjectSpecPatch | null {
  if (value === null || value === undefined) return null;
  const result = projectSpecPatchSchema.safeParse(value);
  return result.success ? result.data : null;
}

function toView(row: {
  id: string;
  summary: string;
  commands: unknown;
  specPatch: unknown;
  status: string;
  failureReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}): ProposalView {
  return {
    id: row.id,
    summary: row.summary,
    commands: readCommands(row.commands),
    specPatch: readSpecPatch(row.specPatch),
    status: row.status as ProposalView['status'],
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

export async function listProposals(projectId: string, userId: string): Promise<ProposalView[]> {
  await assertProjectAccess(projectId, userId);
  const rows = await prisma.designProposal.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toView);
}

/**
 * Records a proposal. Called by the agent's tool, never by a user action.
 *
 * Commands are validated here, at creation, as well as again at approval. An
 * invalid command should be rejected while the agent can still see the error
 * and correct itself in conversation.
 *
 * Any earlier pending proposal is superseded: two competing pending changes to
 * the same scene would let the user approve them in an order that produces a
 * result neither proposal described.
 */
export async function createProposal(
  projectId: string,
  userId: string,
  input: { summary: string; commands: SceneCommand[]; specPatch?: ProjectSpecPatch | null }
): Promise<ProposalView> {
  await assertProjectAccess(projectId, userId);

  if (input.commands.length === 0) {
    throw badRequest('A proposal must contain at least one change.');
  }

  const [, row] = await prisma.$transaction([
    prisma.designProposal.updateMany({
      where: { projectId, status: 'pending' },
      data: { status: 'superseded', decidedAt: new Date() },
    }),
    prisma.designProposal.create({
      data: {
        projectId,
        summary: input.summary,
        commands: input.commands as object[],
        specPatch: (input.specPatch ?? undefined) as object | undefined,
      },
    }),
  ]);

  return toView(row);
}

async function loadPending(projectId: string, proposalId: string) {
  const row = await prisma.designProposal.findUnique({ where: { id: proposalId } });
  if (!row || row.projectId !== projectId) throw notFound('Proposal');
  if (row.status !== 'pending') {
    throw new ApiError(
      409,
      `This proposal was already ${row.status}.`,
      'proposal_not_pending'
    );
  }
  return row;
}

/**
 * Applies a proposal after the user approves it.
 *
 * Commands are re-validated and re-applied against the CURRENT scene, not the
 * one that existed when the proposal was written. If the target object has been
 * deleted meanwhile, applying fails and the proposal records why, rather than
 * silently doing something else.
 *
 * A spec patch is written as a new DRAFT specification. It deliberately does not
 * become approved: an agreed dimension is a signed-off fact, and changing it has
 * to pass back through spec approval, which is also what marks calculations,
 * costs and documents downstream as stale.
 */
export async function approveProposal(
  projectId: string,
  userId: string,
  proposalId: string
): Promise<ProposalView> {
  await assertProjectAccess(projectId, userId);
  const row = await loadPending(projectId, proposalId);

  const commands = readCommands(row.commands);
  if (commands.length === 0) {
    await prisma.designProposal.update({
      where: { id: row.id },
      data: {
        status: 'rejected',
        decidedAt: new Date(),
        failureReason: 'The stored commands were not valid and could not be applied.',
      },
    });
    throw badRequest('This proposal could not be applied because its commands are invalid.');
  }

  try {
    await applyCommands(projectId, userId, commands);
  } catch (error) {
    const reason =
      error instanceof ApiError
        ? error.message
        : 'The canvas could not be updated with this proposal.';
    await prisma.designProposal.update({
      where: { id: row.id },
      data: { status: 'rejected', decidedAt: new Date(), failureReason: reason },
    });
    throw new ApiError(409, `${reason} The proposal was not applied.`, 'proposal_apply_failed');
  }

  const specPatch = readSpecPatch(row.specPatch);
  if (specPatch) {
    await updateDraftSpec(projectId, userId, specPatch);
  }

  const updated = await prisma.designProposal.update({
    where: { id: row.id },
    data: { status: 'approved', decidedAt: new Date(), failureReason: null },
  });

  // Recorded after the commands and any spec patch have landed, so the snapshot
  // is the design as approved rather than the one before it. Outside the
  // transaction on purpose: the proposal is already applied and recorded, and
  // failing to write the history entry must not undo an accepted design.
  try {
    await recordVersion(projectId, {
      reason: 'design_approved',
      label: `Design approved: ${row.summary}`,
    });
  } catch (error) {
    console.error('[design] could not record a version for the approved design', error);
  }

  await recordAudit({
    userId,
    projectId,
    action: 'design.approved',
    summary: `Approved design change: ${row.summary}`,
    detail: { proposalId: row.id, commandCount: commands.length },
  });

  return toView(updated);
}

export async function rejectProposal(
  projectId: string,
  userId: string,
  proposalId: string
): Promise<ProposalView> {
  await assertProjectAccess(projectId, userId);
  const row = await loadPending(projectId, proposalId);

  const updated = await prisma.designProposal.update({
    where: { id: row.id },
    data: { status: 'rejected', decidedAt: new Date() },
  });

  await recordAudit({
    userId,
    projectId,
    action: 'design.rejected',
    summary: `Rejected design change: ${row.summary}`,
    detail: { proposalId: row.id },
  });

  return toView(updated);
}
