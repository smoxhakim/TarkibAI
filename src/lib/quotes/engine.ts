import { applyBasisPoints } from '@/lib/calc/costs/engine';

/**
 * Deterministic quotation arithmetic.
 *
 * A quote is a commercial document, so the user is the authority on price —
 * but every number printed on it is computed here, never typed twice and never
 * produced by the model. Money stays in integer minor units and quantities in
 * integer thousandths, for the same reason the material and cost engines do it:
 * a floating-point remainder that rounds a line total by one centime turns into
 * a quote whose lines visibly do not add up to its total.
 *
 * # Order of operations
 *
 *   quantity x unit price   = line total   (per line, rounded once)
 *   sum of line totals      = subtotal
 *   subtotal x tax          = tax
 *   subtotal + tax          = total
 *
 * Tax is applied to the subtotal and to nothing else. It is deliberately NOT
 * recomputed per line: rounding each line's tax and summing gives a different
 * figure from taxing the sum, and the sum is what the client is asked to pay.
 */

/** Quantities are stored as thousandths, so 2.5 is 2500. */
export const QUANTITY_SCALE = 1000;

export type QuoteLineInput = {
  description: string;
  /** Quantity in thousandths of a unit. */
  quantityMilli: number;
  unitLabel?: string | null;
  unitPriceCents: number;
};

export type CalculatedQuoteLine = QuoteLineInput & {
  position: number;
  lineTotalCents: number;
};

export type QuoteTotals = {
  lines: CalculatedQuoteLine[];
  subtotalCents: number;
  taxBp: number;
  taxCents: number;
  totalCents: number;
};

/**
 * One line's total, rounded half away from zero.
 *
 * Rounded exactly once, here. Rounding at display time instead would let the
 * printed lines sum to something other than the printed subtotal, which is the
 * first thing a client checks.
 */
export function lineTotalCents(quantityMilli: number, unitPriceCents: number): number {
  if (!Number.isInteger(quantityMilli) || !Number.isInteger(unitPriceCents)) {
    throw new Error('Quote line quantities and unit prices must be integers.');
  }
  const product = quantityMilli * unitPriceCents;
  const sign = product < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(product) / QUANTITY_SCALE);
}

/** Computes every derived figure on a quote from its lines and tax rate. */
export function calculateQuoteTotals(lines: QuoteLineInput[], taxBp: number): QuoteTotals {
  if (!Number.isInteger(taxBp) || taxBp < 0) {
    throw new Error('Tax must be whole, non-negative basis points.');
  }

  const calculated: CalculatedQuoteLine[] = lines.map((line, index) => ({
    ...line,
    position: index,
    lineTotalCents: lineTotalCents(line.quantityMilli, line.unitPriceCents),
  }));

  const subtotalCents = calculated.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const taxCents = applyBasisPoints(subtotalCents, taxBp);

  return {
    lines: calculated,
    subtotalCents,
    taxBp,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}

/**
 * How far a quote's subtotal has moved from the calculated client subtotal.
 *
 * A quote is seeded from the cost engine but the user may price differently,
 * and that is legitimate. What is not legitimate is doing it silently: this is
 * reported to the user so a deviation from the calculated price is a visible
 * decision rather than an accident. Null when there is nothing to compare to.
 */
export function subtotalDivergence(
  quoteSubtotalCents: number,
  calculatedClientSubtotalCents: number | null
): { differenceCents: number; direction: 'above' | 'below' } | null {
  if (calculatedClientSubtotalCents === null) return null;
  const differenceCents = quoteSubtotalCents - calculatedClientSubtotalCents;
  if (differenceCents === 0) return null;
  return {
    differenceCents: Math.abs(differenceCents),
    direction: differenceCents > 0 ? 'above' : 'below',
  };
}

/** Formats a quote number as PREFIX-YEAR-NNNN, e.g. Q-2026-0007. */
export function formatQuoteNumber(prefix: string, year: number, sequence: number): string {
  const cleanPrefix = prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'Q';
  return `${cleanPrefix}-${year}-${String(sequence).padStart(4, '0')}`;
}
