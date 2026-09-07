/**
 * The client-safe shape of a quotation.
 *
 * This is the ONLY type the PDF template consumes, and it is built field by
 * field from explicit values rather than by spreading a database row and
 * deleting the private parts. The difference matters: with a deny-list, adding
 * an internal column later leaks it by default. Here, a new internal column is
 * simply absent unless somebody deliberately adds it to this type — and the
 * leak test below would then fail.
 *
 * Nothing on this type may express cost, margin, purchase price, supplier or
 * waste. See `INTERNAL_FIELD_NAMES` for the guard that enforces it.
 */

export type QuoteDocumentLine = {
  position: number;
  description: string;
  quantityMilli: number;
  unitLabel: string | null;
  unitPriceCents: number;
  lineTotalCents: number;
};

/** An image already resolved to bytes, since a PDF cannot follow a signed URL. */
export type EmbeddedImage = {
  dataUri: string;
  mimeType: string;
};

export type QuoteIssuer = {
  companyName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxIdentifiers: string | null;
  primaryColorHex: string | null;
  logo: EmbeddedImage | null;
};

export type QuoteClient = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
};

export type QuoteDocument = {
  number: string;
  /** Null on a draft preview, which is watermarked rather than dated. */
  issuedAt: string | null;
  validUntil: string | null;
  isDraft: boolean;

  issuer: QuoteIssuer;
  client: QuoteClient;

  projectTitle: string;
  projectDescription: string | null;

  lines: QuoteDocumentLine[];
  currency: string;
  subtotalCents: number;
  taxBp: number;
  taxCents: number;
  totalCents: number;

  termsText: string | null;
  paymentDetails: string | null;
  footerText: string | null;

  mockup: EmbeddedImage | null;
};

/**
 * Field names that must never appear on a quote document.
 *
 * Used by the guard below and by the leak tests. This is a second line of
 * defence, not the primary one — the primary one is that `QuoteDocument` has no
 * such fields to begin with.
 */
export const INTERNAL_FIELD_NAMES = [
  'materialsCostCents',
  'laborCostCents',
  'transportCostCents',
  'installCostCents',
  'otherCostCents',
  'internalTotalCents',
  'marginCents',
  'marginBp',
  'unitPriceCents_purchase',
  'purchasePriceCents',
  'supplier',
  'wasteQuantity',
  'wastePercent',
] as const;

/**
 * Throws if an internal field has been attached to a quote document.
 *
 * Called on the way into the renderer. It cannot catch a leak that arrives
 * inside a free-text field a user typed themselves — that is the user's own
 * document to write — but it does catch a future refactor that widens the type
 * or spreads a cost row into it.
 */
export function assertClientSafe(document: QuoteDocument): void {
  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if ((INTERNAL_FIELD_NAMES as readonly string[]).includes(key)) {
        throw new Error(
          `Internal cost data reached the quote document at ${path}.${key}. A client document must not carry it.`
        );
      }
      walk(child, `${path}.${key}`);
    }
  };

  walk(document, 'quote');
}
