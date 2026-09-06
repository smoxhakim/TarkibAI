import { describe, expect, it } from 'vitest';
import { calculateMaterialLine, ceilDiv, type CalculationInput } from './engine';

const linear = (overrides: Partial<CalculationInput> = {}): CalculationInput => ({
  measurementModel: 'linear',
  requiredQuantity: 25,
  standardLengthMm: 6000,
  sheetWidthMm: null,
  sheetHeightMm: null,
  unitPriceCents: 12000,
  ...overrides,
});

const sheet = (overrides: Partial<CalculationInput> = {}): CalculationInput => ({
  measurementModel: 'sheet',
  requiredQuantity: 10,
  standardLengthMm: null,
  sheetWidthMm: 2440,
  sheetHeightMm: 1220,
  unitPriceCents: 85000,
  ...overrides,
});

function expectSupported(result: ReturnType<typeof calculateMaterialLine>) {
  if (!result.supported) throw new Error(`expected a supported result, got: ${result.reason}`);
  return result;
}

describe('ceilDiv', () => {
  it('rounds up on any remainder', () => {
    expect(ceilDiv(25, 6)).toBe(5);
    expect(ceilDiv(1, 6)).toBe(1);
    expect(ceilDiv(7, 6)).toBe(2);
  });

  it('does not round up on an exact division', () => {
    expect(ceilDiv(24, 6)).toBe(4);
    expect(ceilDiv(6, 6)).toBe(1);
  });
});

describe('linear materials — the PRD worked example', () => {
  it('turns 25 m of requirement into 5 six-metre bars, 30 m purchased, 5 m waste', () => {
    const result = expectSupported(calculateMaterialLine(linear()));

    expect(result.unitsToPurchase).toBe(5);
    expect(result.purchasedQuantity).toBe(30);
    expect(result.wasteQuantity).toBe(5);
    expect(result.wastePercent).toBeCloseTo(16.67, 2);
    expect(result.totalCostCents).toBe(5 * 12000);
    expect(result.unit).toBe('m');
  });

  it('does not buy a spare bar when the requirement divides exactly', () => {
    const result = expectSupported(calculateMaterialLine(linear({ requiredQuantity: 24 })));
    expect(result.unitsToPurchase).toBe(4);
    expect(result.wasteQuantity).toBe(0);
    expect(result.wastePercent).toBe(0);
  });

  it('buys one bar for any requirement below a single bar', () => {
    const result = expectSupported(calculateMaterialLine(linear({ requiredQuantity: 0.5 })));
    expect(result.unitsToPurchase).toBe(1);
    expect(result.purchasedQuantity).toBe(6);
    expect(result.wasteQuantity).toBe(5.5);
  });

  it('buys a whole extra bar for a requirement one millimetre over', () => {
    // 6.001 m needs two bars. Getting this wrong sends one bar to the workshop
    // for a job that cannot be cut from it.
    const result = expectSupported(calculateMaterialLine(linear({ requiredQuantity: 6.001 })));
    expect(result.unitsToPurchase).toBe(2);
  });

  it('stays exact on quantities that misbehave in binary floating point', () => {
    // 0.1 + 0.2 style values: 2.4 / 0.8 is 2.9999999999999996 as a float, and a
    // naive Math.ceil would buy 3 bars where 3 is right — but 0.3 / 0.1 gives
    // 2.9999999999999996 where the true answer is exactly 3, and other pairs
    // round the wrong way. Integer millimetres remove the class of bug.
    const result = expectSupported(
      calculateMaterialLine(linear({ requiredQuantity: 2.4, standardLengthMm: 800 }))
    );
    expect(result.unitsToPurchase).toBe(3);
    expect(result.wasteQuantity).toBe(0);
  });

  it('reports the unrounded division in its explanation', () => {
    const result = expectSupported(calculateMaterialLine(linear()));
    const step = result.steps.find((s) => s.label === 'Bars needed');
    // The user should see that 4.167 was rounded up, not just the final 5.
    expect(step?.value).toContain('4.167');
    expect(step?.value).toContain('5');
  });

  it('refuses to guess when the stock length is missing', () => {
    const result = calculateMaterialLine(linear({ standardLengthMm: null }));
    expect(result.supported).toBe(false);
    if (!result.supported) expect(result.reason).toContain('standard stock length');
  });
});

describe('sheet materials', () => {
  it('derives a sheet count from total area', () => {
    // A 2.44 x 1.22 m sheet is 2.9768 m²; 10 m² needs 4 sheets.
    const result = expectSupported(calculateMaterialLine(sheet()));
    expect(result.unitsToPurchase).toBe(4);
    expect(result.purchasedQuantity).toBeCloseTo(11.9072, 3);
    expect(result.totalCostCents).toBe(4 * 85000);
  });

  it('always warns that the count assumes perfect nesting', () => {
    const result = expectSupported(calculateMaterialLine(sheet()));
    // Presenting an area division as a real sheet count would be exactly the
    // fabricated optimisation result the PRD forbids.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('sheet_nesting_estimate');
    expect(result.warnings[0].message).toContain('MINIMUM');
  });

  it('needs only one sheet when the area fits inside one', () => {
    const result = expectSupported(calculateMaterialLine(sheet({ requiredQuantity: 2 })));
    expect(result.unitsToPurchase).toBe(1);
  });

  it('refuses to guess when the sheet size is missing', () => {
    expect(calculateMaterialLine(sheet({ sheetWidthMm: null })).supported).toBe(false);
    expect(calculateMaterialLine(sheet({ sheetHeightMm: null })).supported).toBe(false);
  });
});

describe('area materials', () => {
  it('purchases exactly what is required, with no rounding and no waste', () => {
    const result = expectSupported(
      calculateMaterialLine({
        measurementModel: 'area',
        requiredQuantity: 12.5,
        standardLengthMm: null,
        sheetWidthMm: null,
        sheetHeightMm: null,
        unitPriceCents: 4500,
      })
    );

    expect(result.unitsToPurchase).toBeNull();
    expect(result.purchasedQuantity).toBe(12.5);
    expect(result.wasteQuantity).toBe(0);
    expect(result.totalCostCents).toBe(Math.round(12.5 * 4500));
  });

  it('rounds cost to whole minor units', () => {
    const result = expectSupported(
      calculateMaterialLine({
        measurementModel: 'area',
        requiredQuantity: 1.333,
        standardLengthMm: null,
        sheetWidthMm: null,
        sheetHeightMm: null,
        unitPriceCents: 4500,
      })
    );
    expect(Number.isInteger(result.totalCostCents)).toBe(true);
  });
});

describe('piece materials', () => {
  it('buys whole pieces', () => {
    const result = expectSupported(
      calculateMaterialLine({
        measurementModel: 'piece',
        requiredQuantity: 12,
        standardLengthMm: null,
        sheetWidthMm: null,
        sheetHeightMm: null,
        unitPriceCents: 1200,
      })
    );
    expect(result.unitsToPurchase).toBe(12);
    expect(result.totalCostCents).toBe(14400);
    expect(result.wasteQuantity).toBe(0);
  });

  it('rounds a fractional count up to a whole piece', () => {
    const result = expectSupported(
      calculateMaterialLine({
        measurementModel: 'piece',
        requiredQuantity: 11.2,
        standardLengthMm: null,
        sheetWidthMm: null,
        sheetHeightMm: null,
        unitPriceCents: 1200,
      })
    );
    expect(result.unitsToPurchase).toBe(12);
  });
});

describe('input guards', () => {
  it('refuses a zero, negative, or non-finite requirement', () => {
    for (const requiredQuantity of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(calculateMaterialLine(linear({ requiredQuantity })).supported).toBe(false);
    }
  });

  it('is deterministic — identical inputs give identical output', () => {
    const a = calculateMaterialLine(linear());
    const b = calculateMaterialLine(linear());
    expect(a).toEqual(b);
  });

  it('never returns a fractional purchase count for discrete stock', () => {
    for (const requiredQuantity of [1, 3.7, 12.34, 25, 99.999]) {
      const result = expectSupported(calculateMaterialLine(linear({ requiredQuantity })));
      expect(Number.isInteger(result.unitsToPurchase)).toBe(true);
    }
  });

  it('never purchases less than required', () => {
    // The invariant that matters most: under-buying stops a job mid-fabrication.
    for (const requiredQuantity of [0.001, 1, 5.999, 6, 6.001, 23.4, 25, 100]) {
      const result = expectSupported(calculateMaterialLine(linear({ requiredQuantity })));
      expect(result.purchasedQuantity).toBeGreaterThanOrEqual(requiredQuantity - 1e-9);
    }
  });
});
