/**
 * What a job is expected to make, and the honesty that requires.
 *
 * # This is a PROJECTION, and the naming says so everywhere
 *
 * The product knows two things: what the calculation engines estimated the job
 * would cost, and what the client was quoted. It does NOT know what the job
 * actually cost — nobody records invoices, delivery notes, hours worked or
 * offcuts wasted in it. Calling the difference "profit" would present an
 * estimate as a result, and a business that trusted it would be making
 * decisions on a number nothing measured.
 *
 * So every figure here is `projected`, the basis is carried alongside it, and
 * a project missing either half reports which half rather than substituting a
 * zero. Recording actuals is a real feature; it is not this one, and pretending
 * otherwise is the failure this whole product is built to avoid (PRD 5.3).
 */

export type ProfitabilityInput = {
  /** From the cost engine. Null when the project has never been costed. */
  internalTotalCents: number | null;
  /** What the client was quoted, before tax. Null when nothing is issued. */
  quotedSubtotalCents: number | null;
  /** One-off expenses the user recorded against the project. Real amounts. */
  recordedExpensesCents: number;
};

export type Profitability = {
  /** Quoted subtotal minus estimated internal cost. Null when either is absent. */
  projectedMarginCents: number | null;
  /** Basis points of the quoted subtotal. Null when there is nothing to divide by. */
  projectedMarginBp: number | null;
  internalTotalCents: number | null;
  quotedSubtotalCents: number | null;
  recordedExpensesCents: number;
  /**
   * Why a figure is missing, in the user's terms. Empty when the projection is
   * complete. Never accompanied by a zero standing in for a real number.
   */
  missing: string[];
  /** Always true. Kept on the payload so a consumer cannot forget. */
  isProjection: true;
};

/** Basis points of a base, rounded half away from zero. Base 0 gives null. */
function marginBp(marginCents: number, baseCents: number): number | null {
  if (baseCents === 0) return null;
  const value = (marginCents * 10_000) / baseCents;
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

export function calculateProfitability(input: ProfitabilityInput): Profitability {
  const missing: string[] = [];
  if (input.internalTotalCents === null) {
    missing.push('The project has not been costed, so there is nothing to compare a price against.');
  }
  if (input.quotedSubtotalCents === null) {
    missing.push('No quote has been issued, so there is no price to compare.');
  }

  const complete = input.internalTotalCents !== null && input.quotedSubtotalCents !== null;
  const projectedMarginCents = complete
    ? input.quotedSubtotalCents! - input.internalTotalCents!
    : null;

  return {
    projectedMarginCents,
    projectedMarginBp:
      projectedMarginCents === null ? null : marginBp(projectedMarginCents, input.quotedSubtotalCents!),
    internalTotalCents: input.internalTotalCents,
    quotedSubtotalCents: input.quotedSubtotalCents,
    recordedExpensesCents: input.recordedExpensesCents,
    missing,
    isProjection: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Across a workspace                                                          */
/* -------------------------------------------------------------------------- */

export type PipelineCounts = Record<string, number>;

export type QuoteOutcome = {
  issued: number;
  /** Quotes a client approved through a share link (T19). */
  approved: number;
  /** Quotes a client asked changes on. */
  changesRequested: number;
  /** Issued quotes with no client response either way. */
  awaiting: number;
  /**
   * Approved / issued, in basis points. Null while nothing has been issued —
   * a win rate over zero quotes is not zero, it is unknown.
   */
  winRateBp: number | null;
};

export function summariseOutcomes(input: {
  issued: number;
  approved: number;
  changesRequested: number;
}): QuoteOutcome {
  const awaiting = Math.max(0, input.issued - input.approved - input.changesRequested);
  return {
    ...input,
    awaiting,
    winRateBp: input.issued === 0 ? null : marginBp(input.approved, input.issued),
  };
}
