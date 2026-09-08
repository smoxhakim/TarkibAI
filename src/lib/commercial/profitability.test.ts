import { describe, expect, it } from 'vitest';
import { calculateProfitability, summariseOutcomes } from './profitability';

const input = (patch: Partial<Parameters<typeof calculateProfitability>[0]> = {}) => ({
  internalTotalCents: 190_000,
  quotedSubtotalCents: 266_000,
  recordedExpensesCents: 0,
  ...patch,
});

describe('calculateProfitability', () => {
  it('projects the margin between the estimate and the price', () => {
    const result = calculateProfitability(input());

    expect(result.projectedMarginCents).toBe(76_000);
    // 76000 / 266000 = 28.57%
    expect(result.projectedMarginBp).toBe(2857);
    expect(result.missing).toEqual([]);
  });

  it('always says it is a projection', () => {
    // The product knows what it estimated and what it quoted. It does not know
    // what the job cost, and presenting this as realised profit would be a
    // number nothing measured.
    expect(calculateProfitability(input()).isProjection).toBe(true);
  });

  it('reports a loss rather than clamping at zero', () => {
    const result = calculateProfitability(input({ quotedSubtotalCents: 150_000 }));

    expect(result.projectedMarginCents).toBe(-40_000);
    expect(result.projectedMarginBp).toBe(-2667);
  });

  it('says which half is missing instead of substituting a zero', () => {
    const uncosted = calculateProfitability(input({ internalTotalCents: null }));
    expect(uncosted.projectedMarginCents).toBeNull();
    expect(uncosted.projectedMarginBp).toBeNull();
    expect(uncosted.missing.join(' ')).toMatch(/not been costed/i);

    const unquoted = calculateProfitability(input({ quotedSubtotalCents: null }));
    expect(unquoted.projectedMarginCents).toBeNull();
    expect(unquoted.missing.join(' ')).toMatch(/No quote has been issued/i);

    const neither = calculateProfitability(
      input({ internalTotalCents: null, quotedSubtotalCents: null })
    );
    expect(neither.missing).toHaveLength(2);
  });

  it('does not divide by a quote of nothing', () => {
    const result = calculateProfitability(input({ quotedSubtotalCents: 0 }));
    expect(result.projectedMarginCents).toBe(-190_000);
    expect(result.projectedMarginBp).toBeNull();
  });

  it('carries recorded expenses through without folding them into the margin', () => {
    // These are real amounts the user entered, and they are already inside the
    // internal total via the cost engine. Subtracting them again would double
    // count them.
    const result = calculateProfitability(input({ recordedExpensesCents: 12_000 }));
    expect(result.recordedExpensesCents).toBe(12_000);
    expect(result.projectedMarginCents).toBe(76_000);
  });
});

describe('summariseOutcomes', () => {
  it('counts what the clients did', () => {
    const result = summariseOutcomes({ issued: 10, approved: 4, changesRequested: 3 });

    expect(result).toMatchObject({ issued: 10, approved: 4, changesRequested: 3, awaiting: 3 });
    expect(result.winRateBp).toBe(4000);
  });

  it('reports an unknown win rate as unknown, not as zero', () => {
    // Nobody has quoted anything yet. A displayed 0% would read as "we never
    // win", which is a claim about a business that has not started.
    expect(summariseOutcomes({ issued: 0, approved: 0, changesRequested: 0 }).winRateBp).toBeNull();
  });

  it('never reports a negative number awaiting a reply', () => {
    // A client can approve and later ask for changes on the same quote, so the
    // two counts can exceed the number issued.
    expect(summariseOutcomes({ issued: 2, approved: 2, changesRequested: 2 }).awaiting).toBe(0);
  });
});
