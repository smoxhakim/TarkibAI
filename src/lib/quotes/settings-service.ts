import { prisma } from '@/lib/db';
import { assertWorkspacePermission, type WorkspaceId } from '@/lib/workspaces/access';
import { ApiError, badRequest } from '@/lib/http/api';
import { buildObjectKey } from '@/lib/storage/keys';
import { isStorageConfigured } from '@/lib/storage/config';
import type { QuoteSettings } from '@/generated/prisma/client';
import type { QuoteSettingsPayload } from './schema';

/**
 * Defaults for a user who has not set up quoting yet.
 *
 * The company block is deliberately empty rather than pre-filled with anything
 * plausible. A quote that goes out with an invented company name is worse than
 * one that refuses to be issued, which is what happens until it is set.
 */
const DEFAULTS = {
  validityDays: 30,
  numberPrefix: 'Q',
} as const;

export async function getQuoteSettings(workspaceId: WorkspaceId): Promise<QuoteSettings> {
  const existing = await prisma.quoteSettings.findUnique({ where: { workspaceId } });
  if (existing) return existing;

  // Seeded once from the workspace's own name, then independent: what the
  // business is called and what a client should see need not stay in step.
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, personal: true },
  });

  return prisma.quoteSettings.create({
    // A personal workspace is named after its owner, which is rarely the
    // trading name, so it seeds empty rather than with something a client
    // should not see on a quote.
    data: {
      workspaceId,
      ...DEFAULTS,
      companyName: workspace && !workspace.personal ? workspace.name : null,
    },
  });
}

/**
 * The company identity printed on every quotation.
 *
 * `quote.create` — the single quote WRITE permission — because this decides
 * what a client sees at the top of a document, and the numbering series that
 * identifies it. Reading the settings is not gated: the panel that displays
 * them is already behind workspace membership, and there is no price here.
 *
 * Asserted at the service rather than only in the route, so the permission
 * travels with the operation instead of with its one current caller.
 */
export async function updateQuoteSettings(
  workspaceId: WorkspaceId,
  userId: string,
  input: QuoteSettingsPayload
): Promise<QuoteSettings> {
  await assertWorkspacePermission(workspaceId, userId, 'quote.create');

  return prisma.quoteSettings.upsert({
    where: { workspaceId },
    update: input,
    create: { workspaceId, ...input },
  });
}

/** Logos are small; anything larger is a photograph pasted in by mistake. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Stores a company logo.
 *
 * Project files upload straight from the browser to R2 because they can be
 * large (ARCHITECTURE 7). A logo is capped at 2 MB and replaces a single row
 * field, so it goes through the server instead: the presign/confirm handshake
 * exists to keep big uploads off the app server, and there is nothing here for
 * it to protect against.
 */
export async function setQuoteLogo(
  workspaceId: WorkspaceId,
  userId: string,
  bytes: Buffer,
  mimeType: string
): Promise<QuoteSettings> {
  // Before the bytes are validated and well before anything is written to R2:
  // a caller who may not change the quote may not put an image on it either.
  await assertWorkspacePermission(workspaceId, userId, 'quote.create');

  if (!isStorageConfigured()) {
    throw new ApiError(503, 'File storage is not configured, so a logo cannot be stored.', 'storage_unavailable');
  }
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw badRequest('A logo must be a PNG, JPEG or WebP image.');
  }
  if (bytes.byteLength === 0) throw badRequest('The uploaded logo was empty.');
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw badRequest('A logo must be 2 MB or smaller.');
  }

  const { putObject, deleteObject } = await import('@/lib/storage/r2');
  const settings = await getQuoteSettings(workspaceId);

  const objectKey = buildObjectKey({
    userId: workspaceId,
    // Not project-scoped: a logo belongs to the business, not to one job.
    projectId: 'account',
    fileId: `logo-${Date.now()}`,
    category: 'documents',
    mimeType,
  });

  await putObject(objectKey, bytes, mimeType);

  const updated = await prisma.quoteSettings.update({
    where: { workspaceId },
    data: { logoObjectKey: objectKey, logoMimeType: mimeType },
  });

  // Best effort. A stale object costs storage; failing the request after the
  // new logo is already live would be worse.
  if (settings.logoObjectKey && settings.logoObjectKey !== objectKey) {
    deleteObject(settings.logoObjectKey).catch((error) =>
      console.error('[quotes] could not remove the replaced logo', error)
    );
  }

  return updated;
}

export async function removeQuoteLogo(
  workspaceId: WorkspaceId,
  userId: string
): Promise<QuoteSettings> {
  await assertWorkspacePermission(workspaceId, userId, 'quote.create');

  const settings = await getQuoteSettings(workspaceId);
  if (!settings.logoObjectKey) return settings;

  const updated = await prisma.quoteSettings.update({
    where: { workspaceId },
    data: { logoObjectKey: null, logoMimeType: null },
  });

  const { deleteObject } = await import('@/lib/storage/r2');
  deleteObject(settings.logoObjectKey).catch((error) =>
    console.error('[quotes] could not remove the logo object', error)
  );

  return updated;
}
