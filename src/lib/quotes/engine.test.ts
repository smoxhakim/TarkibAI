import { describe, expect, it } from 'vitest';
import {
  QUANTITY_SCALE,
  calculateQuoteTotals,
  formatQuoteNumber,
  lineTotalCents,
  subtotalDivergence,
} from './engine';

const line = (quantityMilli: number, unitPriceCents: number, description = 'Line') => ({
  description,
  quantityMilli,
  unitPriceCents,
});

describe('lineTotalCents', () => {
  it('multiplies a whole quantity exactly', () => {
    expect(lineTotalCents(3 * QUANTITY_SCALE, 25_000)).toBe(75_000);
  });

  it('handles a fractional quantity', () => {
    // 2.5 m2 at 120.00 = 300.00
    expect(lineTotalCents(2_500, 12_000)).toBe(30_000);
  });

  it('rounds half away from zero rather than towards positive infinity', () => {
    // 1.5 x 1 centime = 1.5 centimes. Math.round would give -1 for the
    // negative case; away-from-zero gives -2.
    expect(lineTotalCents(1_500, 1)).toBe(2);
    expect(lineTotalCents(-1_500, 1)).toBe(-2);
    expect(Math.round(-1.5)).toBe(-1);
  });

  it('refuses non-integer inputs instead of silently rounding them', () => {
    expect(() => lineTotalCents(1.5, 100)).toThrow(/integers/);
    expect(() => lineTotalCents(1000, 10.5)).toThrow(/integers/);
  });
});

describe('calculateQuoteTotals', () => {
  it('sums line totals and applies tax to the subtotal', () => {
    const result = calculateQuoteTotals([line(1 * QUANTITY_SCALE, 100_000), line(2 * QUANTITY_SCALE, 25_000)], 2_000);

    expect(result.subtotalCents).toBe(150_000);
    expect(result.taxCents).toBe(30_000);
    expect(result.totalCents).toBe(180_000);
  });

  it('makes the printed lines add up to the printed subtotal', () => {
    // Quantities chosen so every line total needs rounding.
    const result = calculateQuoteTotals(
      [line(333, 1_001), line(667, 1_001), line(1_499, 777)],
      1_500
    );

    const summed = result.lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
    expect(summed).toBe(result.subtotalCents);
    expect(result.totalCents).toBe(result.subtotalCents + result.taxCents);
  });

  it('taxes the subtotal, not each line', () => {
    // Three lines whose individual 20% tax each rounds up; taxing the sum does
    // not. The engine must produce the second figure, because that is what the
    // client is asked to pay.
    const lines = [line(QUANTITY_SCALE, 3), line(QUANTITY_SCALE, 3), line(QUANTITY_SCALE, 3)];
    const perLineTax = lines.reduce((sum, l) => sum + Math.round((l.unitPriceCents * 2_000) / 10_000), 0);

    const result = calculateQuoteTotals(lines, 2_000);

    expect(result.subtotalCents).toBe(9);
    expect(result.taxCents).toBe(2); // 9 x 20% = 1.8 -> 2
    expect(perLineTax).toBe(3); // 1 + 1 + 1
    expect(result.taxCents).not.toBe(perLineTax);
  });

  it('produces zero for a quote with no lines rather than failing', () => {
    const result = calculateQuoteTotals([], 2_000);
    expect(result).toMatchObject({ subtotalCents: 0, taxCents: 0, totalCents: 0 });
  });

  it('applies no tax when the rate is zero', () => {
    const result = calculateQuoteTotals([line(QUANTITY_SCALE, 50_000)], 0);
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(50_000);
  });

  it('numbers the lines in the order given', () => {
    const result = calculateQuoteTotals(
      [line(QUANTITY_SCALE, 1, 'a'), line(QUANTITY_SCALE, 1, 'b')],
      0
    );
    expect(result.lines.map((l) => [l.position, l.description])).toEqual([
      [0, 'a'],
      [1, 'b'],
    ]);
  });

  it('refuses a negative or fractional tax rate', () => {
    expect(() => calculateQuoteTotals([], -1)).toThrow(/basis points/);
    expect(() => calculateQuoteTotals([], 12.5)).toThrow(/basis points/);
  });
});

describe('subtotalDivergence', () => {
  it('reports nothing when the quote matches the calculation', () => {
    expect(subtotalDivergence(150_000, 150_000)).toBeNull();
  });

  it('reports nothing when there is no calculation to compare against', () => {
    expect(subtotalDivergence(150_000, null)).toBeNull();
  });

  it('reports the size and direction of a deviation', () => {
    expect(subtotalDivergence(160_000, 150_000)).toEqual({
      differenceCents: 10_000,
      direction: 'above',
    });
    expect(subtotalDivergence(140_000, 150_000)).toEqual({
      differenceCents: 10_000,
      direction: 'below',
    });
  });
});

describe('formatQuoteNumber', () => {
  it('pads the sequence to four digits', () => {
    expect(formatQuoteNumber('Q', 2026, 7)).toBe('Q-2026-0007');
    expect(formatQuoteNumber('Q', 2026, 1234)).toBe('Q-2026-1234');
  });

  it('does not truncate a sequence past four digits', () => {
    expect(formatQuoteNumber('Q', 2026, 12345)).toBe('Q-2026-12345');
  });

  it('normalises the prefix and falls back when it is unusable', () => {
    expect(formatQuoteNumber(' dev ', 2026, 1)).toBe('DEV-2026-0001');
    expect(formatQuoteNumber('***', 2026, 1)).toBe('Q-2026-0001');
  });
});
