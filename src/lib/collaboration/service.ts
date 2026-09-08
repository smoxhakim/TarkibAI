import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { ApiError, badRequest, notFound } from '@/lib/http/api';
import { assertProjectAccess, assertProjectPermission } from '@/lib/projects/service';
import { recordAudit } from '@/lib/audit/service';
import { getSpec } from '@/lib/spec/service';
import { getQuoteSettings } from '@/lib/quotes/settings-service';
import { buildSummary } from '@/lib/production/summary';
import { formatMoney, formatQuantity } from '@/lib/quotes/format';
import { formatDate } from '@/lib/pdf/format';
import { inlineStoredImage, rasteriseSvg, type EmbeddedImage } from '@/lib/pdf/image';
import { asWorkspaceId } from '@/lib/workspaces/access';
import type { ProjectComment, ProjectShare } from '@/generated/prisma/client';
import {
  assertShareSafe,
  type ShareView,
  type SharedMessage,
  type SharedQuote,
} from './share-view';
import type { CreateSharePayload } from './schema';

/** Long enough that guessing one is not a way into somebody's project. */
const SHARE_TOKEN_BYTES = 32;
const MOCKUP_WIDTH = 1400;
const DRAWING_WIDTH = 1600;

/* -------------------------------------------------------------------------- */
/* Managing shares (team side)                                                 */
/* -------------------------------------------------------------------------- */

export type ShareRow = ProjectShare & { active: boolean; path: string };

function describe(share: ProjectShare): ShareRow {
  const expired = share.expiresAt !== null && share.expiresAt < new Date();
  return {
    ...share,
    active: share.revokedAt === null && !expired,
    path: `/share/${share.token}`,
  };
}

export async function listShares(projectId: string, userId: string): Promise<ShareRow[]> {
  await assertProjectAccess(projectId, userId);
  const shares = await prisma.projectShare.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
  return shares.map(describe);
}

/**
 * Creates a share link.
 *
 * Requires `quote.create`: deciding what a client sees is a commercial act, not
 * an editing one, and it is the same group of people who decide what a client
 * is quoted.
 *
 * NO EMAIL IS SENT. There is no mail provider in the product, so the link is
 * returned for the sender to pass on themselves rather than the app implying it
 * has delivered anything.
 */
export async function createShare(
  projectId: string,
  userId: string,
  input: CreateSharePayload
): Promise<ShareRow> {
  await assertProjectPermission(projectId, userId, 'quote.create');

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const share = await prisma.projectShare.create({
    data: {
      projectId,
      token: randomBytes(SHARE_TOKEN_BYTES).toString('base64url'),
      label: input.label ?? null,
      includeQuote: input.includeQuote,
      includeMockups: input.includeMockups,
      includeDrawings: input.includeDrawings,
      allowResponses: input.allowResponses,
      createdByUserId: userId,
      expiresAt,
    },
  });

  await recordAudit({
    userId,
    projectId,
    action: 'share.created',
    summary: `Created a client link${input.label ? ` for ${input.label}` : ''}.`,
    detail: {
      shareId: share.id,
      includeQuote: share.includeQuote,
      includeMockups: share.includeMockups,
      includeDrawings: share.includeDrawings,
      expiresAt: share.expiresAt?.toISOString() ?? null,
    },
  });

  return describe(share);
}

export async function revokeShare(
  projectId: string,
  userId: string,
  shareId: string
): Promise<void> {
  await assertProjectPermission(projectId, userId, 'quote.create');

  const share = await prisma.projectShare.findFirst({ where: { id: shareId, projectId } });
  if (!share) throw notFound('Share');

  // Marked rather than deleted: a link already sent must stay dead, and
  // deleting the row would also detach the client messages that arrived
  // through it.
  await prisma.projectShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });

  await recordAudit({
    userId,
    projectId,
    action: 'share.revoked',
    summary: `Withdrew a client link${share.label ? ` for ${share.label}` : ''}.`,
    detail: { shareId: share.id },
  });
}

/* -------------------------------------------------------------------------- */
/* Resolving a token (client side)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Resolves a share token.
 *
 * Every failure — unknown, revoked, expired — reports the same thing: the link
 * does not work. Distinguishing them would tell somebody probing tokens which
 * of their guesses had once been real.
 */
async function resolveShare(token: string): Promise<ProjectShare> {
  const share = await prisma.projectShare.findUnique({ where: { token } });
  const dead =
    !share || share.revokedAt !== null || (share.expiresAt !== null && share.expiresAt < new Date());

  if (dead) {
    throw new ApiError(404, 'This link is no longer available. Ask for a new one.', 'share_invalid');
  }
  return share!;
}

/** Fetches the images a share includes, downscaled and inlined. */
async function shareImages(share: ProjectShare): Promise<{ mockups: EmbeddedImage[]; drawings: EmbeddedImage[] }> {
  const [mockupRows, drawingRow] = await Promise.all([
    share.includeMockups
      ? prisma.mockup.findMany({
          where: { projectId: share.projectId, status: 'succeeded' },
          orderBy: { createdAt: 'desc' },
          take: 4,
        })
      : Promise.resolve([]),
    share.includeDrawings
      ? prisma.diagram.findFirst({
          where: { projectId: share.projectId },
          orderBy: { version: 'desc' },
        })
      : Promise.resolve(null),
  ]);

  const [mockups, drawing] = await Promise.all([
    Promise.all(mockupRows.map((row) => inlineStoredImage(row.resultObjectKey, MOCKUP_WIDTH))),
    drawingRow ? rasteriseSvg(drawingRow.svg, DRAWING_WIDTH) : Promise.resolve(null),
  ]);

  return {
    mockups: mockups.filter((image): image is EmbeddedImage => image !== null),
    drawings: drawing ? [drawing] : [],
  };
}

/** The most recently issued quote, in client-facing terms only. */
async function sharedQuote(share: ProjectShare): Promise<SharedQuote | null> {
  if (!share.includeQuote) return null;

  const quote = await prisma.quote.findFirst({
    where: { projectId: share.projectId, status: 'issued' },
    include: { lines: { orderBy: { position: 'asc' } } },
    orderBy: { issuedAt: 'desc' },
  });
  if (!quote) return null;

  const money = (cents: number) => formatMoney(cents, quote.currency);
  const percent = (quote.taxBp / 100).toFixed(quote.taxBp % 100 === 0 ? 0 : 2);

  return {
    number: quote.number,
    issuedAt: quote.issuedAt ? formatDate(quote.issuedAt) : null,
    validUntil: quote.validUntil ? formatDate(quote.validUntil) : null,
    lines: quote.lines.map((line) => ({
      description: line.description,
      quantity: formatQuantity(line.quantityMilli),
      unitLabel: line.unitLabel,
      unitPrice: money(line.unitPriceCents),
      lineTotal: money(line.lineTotalCents),
    })),
    subtotal: money(quote.subtotalCents),
    taxLabel: `Tax / TVA (${percent}%)`,
    tax: money(quote.taxCents),
    total: money(quote.totalCents),
    pdfPath: `/api/share/${share.token}/quote.pdf`,
  };
}

function toMessage(comment: ProjectComment, companyName: string | null): SharedMessage {
  return {
    id: comment.id,
    // A member is shown as the business, never by name or email: the client is
    // dealing with a company, and a member's identity is not theirs to have.
    author: comment.authorKind === 'client' ? comment.authorName ?? 'You' : companyName ?? 'The team',
    fromClient: comment.authorKind === 'client',
    kind: comment.kind as SharedMessage['kind'],
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}

/**
 * Builds the whole client view for a token.
 *
 * Assembled field by field from a small number of explicit reads. Nothing in
 * here loads a cost, a material line or a production document — there is no
 * path from this function to one.
 */
export async function getShareView(token: string): Promise<ShareView> {
  const share = await resolveShare(token);

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: share.projectId },
    select: { id: true, title: true, workspaceId: true },
  });

  const [spec, settings, quote, images, comments] = await Promise.all([
    prisma.projectSpec.findFirst({
      where: { projectId: project.id },
      orderBy: { version: 'desc' },
    }),
    getQuoteSettings(asWorkspaceId(project.workspaceId)),
    sharedQuote(share),
    shareImages(share),
    prisma.projectComment.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const { parseSpecData } = await import('@/lib/spec/schema');
  const summary = buildSummary(parseSpecData(spec?.data));

  const approval = comments.find(
    (comment) => comment.authorKind === 'client' && comment.kind === 'approval'
  );

  const view: ShareView = {
    projectTitle: project.title,
    companyName: settings.companyName,
    accentColorHex: settings.primaryColorHex,

    summary: {
      projectType: summary.projectType,
      dimensions: summary.dimensions,
      quantity: summary.quantity,
      environment: summary.environment,
      lighting: summary.lighting,
      lettering: summary.lettering,
      finish: summary.finishNotes,
    },
    quote,
    mockups: images.mockups,
    drawings: images.drawings,

    messages: comments.map((comment) => toMessage(comment, settings.companyName)),
    allowResponses: share.allowResponses,
    approvedAt: approval?.createdAt.toISOString() ?? null,
  };

  assertShareSafe(view);
  return view;
}

/** Records that the link was opened. Best effort — a failed counter is not a failure. */
export async function recordShareView(token: string): Promise<void> {
  try {
    await prisma.projectShare.update({
      where: { token },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
  } catch (error) {
    console.error('[share] could not record a view', error);
  }
}

/** The stored PDF for a shared quote, resolved through the share's own token. */
export async function shareQuotePdfKey(token: string): Promise<string> {
  const share = await resolveShare(token);
  if (!share.includeQuote) throw notFound('Quote');

  const quote = await prisma.quote.findFirst({
    where: { projectId: share.projectId, status: 'issued', pdfObjectKey: { not: null } },
    orderBy: { issuedAt: 'desc' },
    select: { pdfObjectKey: true, number: true },
  });
  if (!quote?.pdfObjectKey) throw notFound('Quote');

  return quote.pdfObjectKey;
}

/* -------------------------------------------------------------------------- */
/* The conversation                                                            */
/* -------------------------------------------------------------------------- */

export async function listComments(projectId: string, userId: string) {
  await assertProjectAccess(projectId, userId);
  return prisma.projectComment.findMany({
    where: { projectId },
    include: { authorUser: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

/** Notifies every member of the workspace except the one who acted. */
async function notifyMembers(
  projectId: string,
  input: { kind: string; summary: string; exceptUserId?: string | null }
): Promise<void> {
  try {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: project.workspaceId },
      select: { userId: true },
    });

    const recipients = members
      .map((member) => member.userId)
      .filter((id) => id !== input.exceptUserId);
    if (recipients.length === 0) return;

    await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        projectId,
        kind: input.kind,
        summary: input.summary,
      })),
    });
  } catch (error) {
    // A notification that could not be written must not undo the thing it was
    // about — the same rule the audit trail follows.
    console.error('[collaboration] could not notify members', error);
  }
}

export async function postComment(
  projectId: string,
  userId: string,
  body: string
): Promise<ProjectComment> {
  await assertProjectPermission(projectId, userId, 'project.edit');

  const comment = await prisma.projectComment.create({
    data: { projectId, authorKind: 'member', authorUserId: userId, body: body.trim() },
  });

  const author = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  await notifyMembers(projectId, {
    kind: 'comment.posted',
    summary: `${author?.name ?? author?.email ?? 'A colleague'} commented on the project.`,
    exceptUserId: userId,
  });

  return comment;
}

/**
 * A client's reply through a share link.
 *
 * Approving is recorded as something a person said, with their name and the
 * time, rather than flattened into a status flag — a project marked "approved"
 * with nobody attached is not evidence of anything.
 */
export async function postClientResponse(
  token: string,
  input: { kind: 'comment' | 'approval' | 'revision_request'; body: string; name: string }
): Promise<void> {
  const share = await resolveShare(token);
  if (!share.allowResponses) {
    throw badRequest('This link is read-only. Contact the sender directly.');
  }

  await prisma.projectComment.create({
    data: {
      projectId: share.projectId,
      authorKind: 'client',
      shareId: share.id,
      authorName: input.name.trim(),
      kind: input.kind,
      body: input.body.trim(),
    },
  });

  const what =
    input.kind === 'approval'
      ? 'approved the project'
      : input.kind === 'revision_request'
        ? 'requested changes'
        : 'left a comment';

  await notifyMembers(share.projectId, {
    kind: `client.${input.kind === 'revision_request' ? 'requested_changes' : input.kind === 'approval' ? 'approved' : 'commented'}`,
    summary: `${input.name.trim()} ${what}.`,
  });
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export async function listNotifications(userId: string, options: { limit?: number } = {}) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.limit ?? 50, 100),
  });
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const result = await prisma.notification.updateMany({
    // Scoped to the caller's own rows, so an id from somewhere else does
    // nothing.
    where: { userId, readAt: null, ...(ids && ids.length > 0 ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return result.count;
}
