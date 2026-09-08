import { prisma } from '@/lib/db';
import { assertProjectAccess } from '@/lib/projects/service';
import type { AuditEvent } from '@/generated/prisma/client';

/**
 * The append-only record of consequential actions.
 *
 * Deliberately narrow. An audit trail that records every read and every
 * recalculation is one nobody scans, and a trail nobody scans provides no
 * safety at all. What goes in here is what changes the meaning of a project or
 * what someone downstream can act on.
 */

export const AUDIT_ACTIONS = [
  'spec.approved',
  'design.approved',
  'design.rejected',
  'quote.issued',
  'quote.deleted',
  'production.generated',
  'version.restored',
  'project.archived',
  'project.restored',
  'project.deleted',
  'material.archived',
  'material.deleted',
  'file.rejected',
  // Who can reach a business's data is exactly the kind of change an audit
  // trail exists for.
  'workspace.created',
  'workspace.invited',
  'workspace.joined',
  'workspace.role_changed',
  'workspace.member_removed',
  // Giving somebody outside the business a view of a project, and taking it
  // away again, is exactly the kind of change worth being able to look up.
  'share.created',
  'share.revoked',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Records an event. Never throws.
 *
 * Every call site is a consequential action that has already succeeded — a
 * quote is issued, a package is stored, a design is applied. Failing the caller
 * because the history entry could not be written would undo real work to
 * protect a record of it, which is backwards. Failures are logged instead, and
 * the gap is visible as a missing entry rather than as a lost action.
 */
export async function recordAudit(input: {
  userId: string;
  projectId?: string | null;
  action: AuditAction;
  summary: string;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        userId: input.userId,
        projectId: input.projectId ?? null,
        action: input.action,
        summary: input.summary,
        detail: (input.detail ?? null) as never,
      },
    });
  } catch (error) {
    console.error('[audit] could not record an event', input.action, error);
  }
}

/** A project's trail, newest first. */
export async function listProjectAudit(
  projectId: string,
  userId: string,
  options: { limit?: number } = {}
): Promise<AuditEvent[]> {
  await assertProjectAccess(projectId, userId);
  return prisma.auditEvent.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.limit ?? 100, 200),
  });
}
