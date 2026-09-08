import { prisma } from '@/lib/db';
import { ApiError, badRequest, notFound } from '@/lib/http/api';
import {
  assertProjectAccess,
  assertProjectPermission,
  hasProjectPermission,
} from '@/lib/projects/service';
import { getCostSettings, getProjectCost } from '@/lib/calc/costs/service';
import { recordVersion } from '@/lib/versions/service';
import { blockersFor, describeBlockers } from '@/lib/validation/service';
import { asWorkspaceId, type WorkspaceId } from '@/lib/workspaces/access';
import { recordAudit } from '@/lib/audit/service';
import { isStorageConfigured } from '@/lib/storage/config';
import { inlineStoredImage } from '@/lib/pdf/image';
import { buildObjectKey } from '@/lib/storage/keys';
import { Prisma } from '@/generated/prisma/client';
import type { Quote, QuoteLine, QuoteSettings } from '@/generated/prisma/client';
import {
  QUANTITY_SCALE,
  calculateQuoteTotals,
  formatQuoteNumber,
  subtotalDivergence,
} from './engine';
import { assertClientSafe, type QuoteDocument } from './document';
import { getQuoteSettings } from './settings-service';
import type { CreateQuotePayload, UpdateQuotePayload } from './schema';

export type QuoteWithLines = Quote & { lines: QuoteLine[] };

export type QuoteView = {
  quote: QuoteWithLines;
  /** How far this quote's subtotal sits from the calculated client subtotal. */
  divergence: ReturnType<typeof subtotalDivergence>;
  /** The calculated client subtotal, for display beside the quote's own. */
  calculatedSubtotalCents: number | null;
  /** Reasons this quote cannot be issued yet. Empty when it can. */
  blockers: string[];
  /** Non-blocking problems the user should see before sending the document. */
  warnings: string[];
};

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

const withLines = { lines: { orderBy: { position: 'asc' } } } as const;

/**
 * Loads a quote and proves the caller owns the project behind it.
 *
 * Ownership is checked through the project rather than through `Quote.userId`,
 * so quotes go through the same single chokepoint as everything else and a
 * missing quote is indistinguishable from someone else's.
 */
async function loadQuote(quoteId: string, userId: string): Promise<QuoteWithLines> {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, include: withLines });
  if (!quote) throw notFound('Quote');
  await assertProjectAccess(quote.projectId, userId);
  return quote;
}

/** The workspace whose company block and rules a quote belongs to. */
async function quoteWorkspace(quote: { projectId: string }): Promise<WorkspaceId> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: quote.projectId },
    select: { workspaceId: true },
  });
  return asWorkspaceId(project.workspaceId);
}

export async function listQuotes(projectId: string, userId: string): Promise<QuoteWithLines[]> {
  await assertProjectAccess(projectId, userId);
  return prisma.quote.findMany({
    where: { projectId },
    include: withLines,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Text the PDF cannot render.
 *
 * The template uses the built-in Helvetica family, which has no Arabic glyphs:
 * Arabic text would come out as blank boxes on a document a client receives.
 * Saying so is the only honest option until a font is embedded, which is a
 * deliberate deferral rather than an oversight.
 */
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

function scriptWarnings(quote: QuoteWithLines, settings: QuoteSettings): string[] {
  const fields = [
    quote.clientName,
    quote.clientAddress,
    quote.title,
    quote.description,
    settings.companyName,
    settings.companyAddress,
    settings.termsText,
    settings.paymentDetails,
    settings.footerText,
    ...quote.lines.map((line) => line.description),
  ];

  return fields.some((value) => value !== null && ARABIC.test(value))
    ? [
        'Some text is in Arabic script, which this PDF template cannot draw — it would print as blank boxes. Rewrite those fields in Latin script until an Arabic font is embedded.',
      ]
    : [];
}

function issueBlockers(quote: QuoteWithLines, settings: QuoteSettings): string[] {
  const blockers: string[] = [];
  if (!settings.companyName?.trim()) {
    blockers.push('Set your company name in quote settings. A quote cannot go out unattributed.');
  }
  if (quote.lines.length === 0) {
    blockers.push('Add at least one line. A quote with no lines prices nothing.');
  }
  if (!isStorageConfigured()) {
    blockers.push('File storage is not configured, so the issued PDF cannot be kept on record.');
  }
  return blockers;
}

export async function getQuoteView(quoteId: string, userId: string): Promise<QuoteView> {
  const quote = await loadQuote(quoteId, userId);
  // A role that may read quotes but not costs — a production manager, say —
  // sees the quote's own figures without the comparison against the internal
  // calculation. The comparison is omitted, not faked.
  const canSeeCost = await hasProjectPermission(quote.projectId, userId, 'cost.view');
  const [settings, costView] = await Promise.all([
    getQuoteSettings(await quoteWorkspace(quote)),
    canSeeCost ? getProjectCost(quote.projectId, userId) : Promise.resolve(null),
  ]);

  const calculatedSubtotalCents = costView?.cost?.clientSubtotalCents ?? null;

  return {
    quote,
    calculatedSubtotalCents,
    divergence: subtotalDivergence(quote.subtotalCents, calculatedSubtotalCents),
    blockers: quote.status === 'issued' ? [] : issueBlockers(quote, settings),
    warnings: scriptWarnings(quote, settings),
  };
}

/* -------------------------------------------------------------------------- */
/* Creating                                                                    */
/* -------------------------------------------------------------------------- */

/** The tax rate and currency in force when a cost was computed. */
function commercialTermsFromCost(snapshot: unknown): { taxBp: number; currency: string } | null {
  if (snapshot === null || typeof snapshot !== 'object') return null;
  const record = snapshot as Record<string, unknown>;
  const taxBp = record.taxBp;
  const currency = record.currency;
  if (typeof taxBp !== 'number' || !Number.isInteger(taxBp)) return null;
  if (typeof currency !== 'string' || currency.length === 0) return null;
  return { taxBp, currency };
}

/**
 * Allocates the next quote number for a business.
 *
 * The number is assigned when the draft is created rather than when it is
 * issued, so a quote has one stable identity from the moment the user starts
 * writing it. The cost is that abandoned drafts leave gaps in the sequence;
 * that is preferable to a document whose reference changes under the user.
 *
 * The unique constraint on (workspaceId, sequence) is the real guard — two
 * members racing will collide there rather than silently handing two clients
 * the same reference.
 */
async function allocateNumber(
  workspaceId: WorkspaceId,
  prefix: string
): Promise<{ sequence: number; number: string }> {
  const last = await prisma.quote.findFirst({
    where: { workspaceId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });
  const sequence = (last?.sequence ?? 0) + 1;
  return { sequence, number: formatQuoteNumber(prefix, new Date().getFullYear(), sequence) };
}

const MAX_NUMBER_ATTEMPTS = 5;

/**
 * Creates a draft quote seeded from the project's calculated cost.
 *
 * Refused until a cost exists. A quote invented without one would be a price
 * with no basis, which is exactly the kind of number this system must never
 * produce (PRD 6).
 */
export async function createQuote(
  projectId: string,
  userId: string,
  input: CreateQuotePayload
): Promise<QuoteWithLines> {
  await assertProjectPermission(projectId, userId, 'quote.create');

  const { cost, blockedReason } = await getProjectCost(projectId, userId);
  if (!cost) {
    throw badRequest(
      blockedReason ??
        'Calculate the project cost before quoting it. A quote is priced from the cost calculation, not from an estimate.'
    );
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { title: true, workspaceId: true },
  });
  const workspaceId = asWorkspaceId(project.workspaceId);
  const [settings, costSettings] = await Promise.all([
    getQuoteSettings(workspaceId),
    getCostSettings(workspaceId),
  ]);

  // The rates that produced this cost, not today's — otherwise editing the tax
  // rate would silently re-price a quote already based on an older calculation.
  const terms = commercialTermsFromCost(cost.settingsSnapshot) ?? {
    taxBp: costSettings.taxBp,
    currency: costSettings.currency,
  };

  const title = input.title?.trim() || project.title;

  // One line, priced at the calculated client subtotal. The engine produced a
  // single subtotal, so that is what the quote starts as. The user splits it
  // into presentation lines afterwards if they want to.
  const seed = calculateQuoteTotals(
    [{ description: title, quantityMilli: QUANTITY_SCALE, unitPriceCents: cost.clientSubtotalCents }],
    terms.taxBp
  );

  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
    const { sequence, number } = await allocateNumber(workspaceId, settings.numberPrefix);
    try {
      return await prisma.quote.create({
        data: {
          projectId,
          workspaceId,
          userId,
          sequence,
          number,
          status: 'draft',
          title,
          description: input.description ?? null,
          clientName: input.clientName,
          clientAddress: input.clientAddress ?? null,
          clientPhone: input.clientPhone ?? null,
          clientEmail: input.clientEmail ?? null,
          subtotalCents: seed.subtotalCents,
          taxBp: seed.taxBp,
          taxCents: seed.taxCents,
          totalCents: seed.totalCents,
          currency: terms.currency,
          sourceCostId: cost.id,
          lines: {
            create: seed.lines.map((line) => ({
              position: line.position,
              description: line.description,
              quantityMilli: line.quantityMilli,
              unitLabel: line.unitLabel ?? null,
              unitPriceCents: line.unitPriceCents,
              lineTotalCents: line.lineTotalCents,
            })),
          },
        },
        include: withLines,
      });
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === MAX_NUMBER_ATTEMPTS - 1) throw error;
      // Another request took this number in between. Read the sequence again.
    }
  }

  throw new ApiError(409, 'Could not allocate a quote number. Try again.', 'number_conflict');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/* -------------------------------------------------------------------------- */
/* Editing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Updates a draft quote.
 *
 * An issued quote is refused rather than versioned in place: the client is
 * holding a document with that number on it. Re-quoting means creating a new
 * quote, which gets its own number.
 */
export async function updateQuote(
  quoteId: string,
  userId: string,
  input: UpdateQuotePayload
): Promise<QuoteWithLines> {
  const quote = await loadQuote(quoteId, userId);
  if (quote.status === 'issued') {
    throw badRequest(
      `Quote ${quote.number} has been issued and cannot be edited. Create a new quote instead — the client is holding a document with that number on it.`
    );
  }

  if (input.mockupId) {
    const mockup = await prisma.mockup.findFirst({
      where: { id: input.mockupId, projectId: quote.projectId },
      select: { status: true },
    });
    if (!mockup) throw notFound('Mockup');
    if (mockup.status !== 'succeeded') {
      throw badRequest('That mockup has not finished generating, so there is no image to print.');
    }
  }

  // Totals are always recomputed from the lines. They are never accepted from
  // the request: a client-supplied total is a number nobody derived.
  const linesChanged = input.lines !== undefined;
  const lineInputs = (input.lines ?? quote.lines).map((line) => ({
    description: line.description,
    quantityMilli: line.quantityMilli,
    unitLabel: line.unitLabel ?? null,
    unitPriceCents: line.unitPriceCents,
  }));
  const totals = calculateQuoteTotals(lineInputs, quote.taxBp);

  return prisma.quote.update({
    where: { id: quoteId },
    data: {
      ...(input.clientName !== undefined ? { clientName: input.clientName } : {}),
      ...(input.clientAddress !== undefined ? { clientAddress: input.clientAddress } : {}),
      ...(input.clientPhone !== undefined ? { clientPhone: input.clientPhone } : {}),
      ...(input.clientEmail !== undefined ? { clientEmail: input.clientEmail } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.mockupId !== undefined ? { mockupId: input.mockupId } : {}),
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      ...(linesChanged
        ? {
            lines: {
              // Replaced wholesale, matching the schema: positions are
              // meaningful and reconciling a partial edit against them would be
              // a source of silent reordering bugs.
              deleteMany: {},
              create: totals.lines.map((line) => ({
                position: line.position,
                description: line.description,
                quantityMilli: line.quantityMilli,
                unitLabel: line.unitLabel ?? null,
                unitPriceCents: line.unitPriceCents,
                lineTotalCents: line.lineTotalCents,
              })),
            },
          }
        : {}),
    },
    include: withLines,
  });
}

export async function deleteQuote(quoteId: string, userId: string): Promise<void> {
  const quote = await loadQuote(quoteId, userId);
  if (quote.status === 'issued') {
    throw badRequest(
      `Quote ${quote.number} has been issued and is part of the record. It cannot be deleted.`
    );
  }
  await prisma.quote.delete({ where: { id: quoteId } });

  await recordAudit({
    userId,
    projectId: quote.projectId,
    action: 'quote.deleted',
    summary: `Deleted draft quote ${quote.number}.`,
    detail: { number: quote.number },
  });
}

/* -------------------------------------------------------------------------- */
/* Document assembly                                                           */
/* -------------------------------------------------------------------------- */

/** The company block as frozen onto an issued quote. */
type IssuerSnapshot = {
  companyName: string;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  taxIdentifiers: string | null;
  primaryColorHex: string | null;
  termsText: string | null;
  paymentDetails: string | null;
  footerText: string | null;
  logoObjectKey: string | null;
};

function snapshotIssuer(settings: QuoteSettings): IssuerSnapshot {
  return {
    companyName: settings.companyName ?? '',
    companyAddress: settings.companyAddress,
    companyPhone: settings.companyPhone,
    companyEmail: settings.companyEmail,
    taxIdentifiers: settings.taxIdentifiers,
    primaryColorHex: settings.primaryColorHex,
    termsText: settings.termsText,
    paymentDetails: settings.paymentDetails,
    footerText: settings.footerText,
    logoObjectKey: settings.logoObjectKey,
  };
}

function readIssuerSnapshot(value: unknown): IssuerSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.companyName !== 'string') return null;
  const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : null);
  return {
    companyName: record.companyName,
    companyAddress: text('companyAddress'),
    companyPhone: text('companyPhone'),
    companyEmail: text('companyEmail'),
    taxIdentifiers: text('taxIdentifiers'),
    primaryColorHex: text('primaryColorHex'),
    termsText: text('termsText'),
    paymentDetails: text('paymentDetails'),
    footerText: text('footerText'),
    logoObjectKey: text('logoObjectKey'),
  };
}

/**
 * Builds the client-safe document for a quote.
 *
 * Every field is read from the quote and the issuer block. The project's cost
 * is never loaded here: this function has no access to an internal figure to
 * leak.
 */
export async function buildQuoteDocument(
  quoteId: string,
  userId: string
): Promise<QuoteDocument> {
  const quote = await loadQuote(quoteId, userId);

  // An issued quote renders from its frozen snapshot so it stays the document
  // that was sent; a draft renders from live settings so edits are visible.
  const issuer =
    (quote.status === 'issued' ? readIssuerSnapshot(quote.issuerSnapshot) : null) ??
    snapshotIssuer(await getQuoteSettings(await quoteWorkspace(quote)));

  const mockupKey = quote.mockupId
    ? (
        await prisma.mockup.findFirst({
          where: { id: quote.mockupId, projectId: quote.projectId, status: 'succeeded' },
          select: { resultObjectKey: true },
        })
      )?.resultObjectKey ?? null
    : null;

  const [logo, mockup] = await Promise.all([
    inlineStoredImage(issuer.logoObjectKey, 400),
    inlineStoredImage(mockupKey, 1200),
  ]);

  const document: QuoteDocument = {
    number: quote.number,
    issuedAt: quote.issuedAt?.toISOString() ?? null,
    validUntil: quote.validUntil?.toISOString() ?? null,
    isDraft: quote.status !== 'issued',

    issuer: {
      companyName: issuer.companyName,
      address: issuer.companyAddress,
      phone: issuer.companyPhone,
      email: issuer.companyEmail,
      taxIdentifiers: issuer.taxIdentifiers,
      primaryColorHex: issuer.primaryColorHex,
      logo,
    },
    client: {
      name: quote.clientName,
      address: quote.clientAddress,
      phone: quote.clientPhone,
      email: quote.clientEmail,
    },

    projectTitle: quote.title,
    projectDescription: quote.description,

    lines: quote.lines.map((line) => ({
      position: line.position,
      description: line.description,
      quantityMilli: line.quantityMilli,
      unitLabel: line.unitLabel,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
    })),
    currency: quote.currency,
    subtotalCents: quote.subtotalCents,
    taxBp: quote.taxBp,
    taxCents: quote.taxCents,
    totalCents: quote.totalCents,

    termsText: issuer.termsText,
    paymentDetails: issuer.paymentDetails,
    footerText: issuer.footerText,

    mockup,
  };

  assertClientSafe(document);
  return document;
}

/** Renders a quote to PDF bytes without storing anything. */
export async function renderQuote(quoteId: string, userId: string): Promise<Buffer> {
  const document = await buildQuoteDocument(quoteId, userId);
  const { renderQuotePdf } = await import('./pdf');
  return renderQuotePdf(document);
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Issues a quote: freezes it, renders the PDF and stores it.
 *
 * Generation is synchronous. A one-page quote renders in well under a second,
 * so pushing it through the job runner (ARCHITECTURE 17) would add a queued
 * state and a failure mode for no benefit. The production package in T14 is the
 * document that will need a job.
 */
export async function issueQuote(quoteId: string, userId: string): Promise<QuoteWithLines> {
  const quote = await loadQuote(quoteId, userId);
  if (quote.status === 'issued') {
    throw badRequest(`Quote ${quote.number} has already been issued.`);
  }

  const settings = await getQuoteSettings(await quoteWorkspace(quote));
  const blockers = issueBlockers(quote, settings);
  if (blockers.length > 0) throw badRequest(blockers.join(' '));

  // A quote's price rests on every material line being current. Issuing one
  // from superseded figures would send a client a number the system already
  // knows is not the project's — the exact failure the validation layer exists
  // to stop (T16).
  const integrity = await blockersFor('quote', quote.projectId, userId);
  if (integrity.length > 0) {
    throw badRequest(
      `This quote would be priced from figures that are no longer current. ${describeBlockers(integrity)}`
    );
  }

  const issuedAt = new Date();
  const validUntil = new Date(issuedAt);
  validUntil.setDate(validUntil.getDate() + settings.validityDays);
  const issuerSnapshot = snapshotIssuer(settings);

  // Written before rendering so the PDF is produced from the same frozen state
  // that the record keeps, rather than from settings that could be edited in
  // between.
  await prisma.quote.update({
    where: { id: quoteId },
    data: {
      status: 'issued',
      issuedAt,
      validUntil,
      issuerSnapshot: issuerSnapshot as unknown as object,
    },
  });

  let pdfObjectKey: string;
  try {
    const pdf = await renderQuote(quoteId, userId);
    pdfObjectKey = buildObjectKey({
      userId,
      projectId: quote.projectId,
      fileId: `quote-${quote.number}`,
      category: 'documents',
      mimeType: 'application/pdf',
    });
    const { putObject } = await import('@/lib/storage/r2');
    await putObject(pdfObjectKey, pdf, 'application/pdf');
  } catch (error) {
    // Rolled back rather than left as an issued quote with no document. A
    // number marked "issued" that the user cannot send is worse than a draft.
    await prisma.quote.update({
      where: { id: quoteId },
      // `undefined` would mean "leave this column alone" to Prisma, quietly
      // keeping a frozen company block on a quote that is a draft again.
      data: { status: 'draft', issuedAt: null, validUntil: null, issuerSnapshot: Prisma.DbNull },
    });
    console.error('[quotes] could not produce the quote PDF', error);
    throw new ApiError(
      502,
      'The quote PDF could not be produced, so the quote is still a draft. Nothing was issued.',
      'pdf_failed'
    );
  }

  // Recorded before the quote is linked to it, so an issued quote always names
  // a version that exists. A failure here must not leave a stored PDF with no
  // quote pointing at it, so the link is simply absent if it cannot be written.
  let projectVersionId: string | null = null;
  try {
    const version = await recordVersion(quote.projectId, {
      reason: 'quote_issued',
      label: `Quote ${quote.number} issued`,
    });
    projectVersionId = version.id;
  } catch (error) {
    console.error('[quotes] could not record a version for the issued quote', error);
  }

  const [issued] = await Promise.all([
    prisma.quote.update({
      where: { id: quoteId },
      data: { pdfObjectKey, projectVersionId },
      include: withLines,
    }),
    // The project has reached the quoting stage. Never moved backwards: a
    // project further along must not regress because an old quote was issued.
    prisma.project.updateMany({
      where: { id: quote.projectId, status: { in: ['intake', 'spec_approved', 'calculated'] } },
      data: { status: 'quoted' },
    }),
  ]);

  await recordAudit({
    userId,
    projectId: quote.projectId,
    action: 'quote.issued',
    summary: `Issued quote ${issued.number} to ${issued.clientName} for ${issued.totalCents / 100} ${issued.currency}.`,
    detail: {
      quoteId: issued.id,
      number: issued.number,
      totalCents: issued.totalCents,
      currency: issued.currency,
      projectVersionId,
    },
  });

  return issued;
}

/** A short-lived signed URL for an issued quote's stored PDF. */
export async function quoteDownloadUrl(quoteId: string, userId: string): Promise<string> {
  const quote = await loadQuote(quoteId, userId);
  if (!quote.pdfObjectKey) {
    throw badRequest('This quote has not been issued, so there is no stored document to download.');
  }
  const { createSignedDownloadUrl } = await import('@/lib/storage/r2');
  return createSignedDownloadUrl(quote.pdfObjectKey, {
    downloadName: `${quote.number}.pdf`,
  });
}
