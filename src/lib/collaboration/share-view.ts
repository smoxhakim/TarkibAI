import type { EmbeddedImage } from '@/lib/pdf/image';

/**
 * Everything a client may see behind a share link, and nothing else.
 *
 * The third client-safe boundary in this product, built the same way as the
 * first two: a type with no field for the private thing, assembled explicitly
 * rather than by filtering a database row. A quote hides internal cost from the
 * document (T13); a production package hides prices from the workshop (T14);
 * this hides everything internal from somebody outside the business entirely.
 *
 * This one is the sharpest, because the reader is not authenticated at all. The
 * link is the whole credential, so the payload must be safe even assuming the
 * token has leaked — there is no second check behind it.
 *
 * Absent by construction: internal cost, margin, purchase prices, supplier
 * names, material quantities and waste, cutting plans, the production package,
 * the audit trail, the version history, workspace membership, and any reference
 * to another project.
 */

export type SharedQuoteLine = {
  description: string;
  quantity: string;
  unitLabel: string | null;
  unitPrice: string;
  lineTotal: string;
};

export type SharedQuote = {
  number: string;
  issuedAt: string | null;
  validUntil: string | null;
  lines: SharedQuoteLine[];
  subtotal: string;
  taxLabel: string;
  tax: string;
  total: string;
  /** Path to the issued PDF, served through the share's own token. */
  pdfPath: string;
};

export type SharedSummary = {
  projectType: string | null;
  dimensions: string | null;
  quantity: number | null;
  environment: string | null;
  lighting: string | null;
  lettering: string | null;
  finish: string | null;
};

export type SharedMessage = {
  id: string;
  /** "team" or the client's own name. Never a member's email. */
  author: string;
  fromClient: boolean;
  kind: 'comment' | 'approval' | 'revision_request';
  body: string;
  createdAt: string;
};

export type ShareView = {
  projectTitle: string;
  companyName: string | null;
  /** Sender's accent colour, so the page looks like the business's own. */
  accentColorHex: string | null;

  summary: SharedSummary;
  quote: SharedQuote | null;
  mockups: EmbeddedImage[];
  drawings: EmbeddedImage[];

  messages: SharedMessage[];
  /** False when the sender made the link read-only. */
  allowResponses: boolean;
  /** Set when the client has already approved, so the page says so. */
  approvedAt: string | null;
};

/**
 * Field names that must never appear anywhere in a share payload.
 *
 * Wider than the earlier guards, because the audience is wider. Checked on the
 * way out of the builder.
 */
export const PRIVATE_FIELD_NAMES = [
  'materialsCostCents',
  'laborCostCents',
  'transportCostCents',
  'installCostCents',
  'otherCostCents',
  'internalTotalCents',
  'marginCents',
  'marginBp',
  'unitPriceCentsSnapshot',
  'totalCostCents',
  'supplier',
  'wastePercent',
  'wasteQuantity',
  'unitsToPurchase',
  'workspaceId',
  'userId',
  'authorUserId',
  'token',
  'objectKey',
  'pdfObjectKey',
  'resultObjectKey',
  'auditEvents',
] as const;

/** Throws if anything private reached the payload. */
export function assertShareSafe(view: ShareView): void {
  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if ((PRIVATE_FIELD_NAMES as readonly string[]).includes(key)) {
        throw new Error(
          `Internal data reached a client share at ${path}.${key}. A share is read by somebody outside the business.`
        );
      }
      walk(child, `${path}.${key}`);
    }
  };

  walk(view, 'share');
}
