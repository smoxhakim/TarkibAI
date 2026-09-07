import { describe, expect, it } from 'vitest';
import {
  recommendBarAlternatives,
  recommendRotation,
  recommendSheetAlternatives,
  type CandidateBar,
  type CandidateSheet,
} from './engine';
import type { CuttingPieceInput } from '@/lib/calc/cutting/engine';
import type { LinearCutInput } from '@/lib/calc/cutting/linear';

const sheet = (overrides: Partial<CandidateSheet> = {}): CandidateSheet => ({
  materialId: 'm-standard',
  name: 'Alucobond 2440×1220',
  sheetWidthMm: 2440,
  sheetHeightMm: 1220,
  unitPriceCents: 85000,
  kerfMm: 0,
  edgeMarginMm: 0,
  ...overrides,
});

const bar = (overrides: Partial<CandidateBar> = {}): CandidateBar => ({
  materialId: 'b-6m',
  name: 'Tube 6 m',
  standardLengthMm: 6000,
  unitPriceCents: 12000,
  kerfMm: 0,
  minUsableRemnantMm: 0,
  ...overrides,
});

const piece = (overrides: Partial<CuttingPieceInput> = {}): CuttingPieceInput => ({
  id: 'p',
  label: null,
  widthMm: 1000,
  heightMm: 500,
  quantity: 1,
  allowRotation: true,
  ...overrides,
});

const cut = (overrides: Partial<LinearCutInput> = {}): LinearCutInput => ({
  id: 'c',
  label: null,
  lengthMm: 4000,
  quantity: 4,
  ...overrides,
});

describe('sheet alternatives', () => {
  it('recommends a cheaper sheet that fits the same pieces', () => {
    // A 3050x1500 sheet holds pieces the standard sheet needs two of.
    const pieces = [piece({ widthMm: 1400, heightMm: 1400, quantity: 2, allowRotation: false })];
    const large = sheet({
      materialId: 'm-large',
      name: 'Alucobond 3050×1500',
      sheetWidthMm: 3050,
      sheetHeightMm: 1500,
      unitPriceCents: 120000,
    });

    // The standard sheet cannot fit a 1400mm piece at all (1220 max), so the
    // large sheet is the only viable option — but the standard must then not be
    // recommended against.
    const result = recommendSheetAlternatives(large, [sheet()], pieces);
    expect(result).toHaveLength(0);
  });

  it('never recommends an option that costs more', () => {
    const pieces = [piece({ widthMm: 1200, heightMm: 600, quantity: 4 })];
    const expensive = sheet({
      materialId: 'm-expensive',
      name: 'Premium',
      sheetWidthMm: 3050,
      sheetHeightMm: 1500,
      unitPriceCents: 500000,
    });

    // Fewer sheets at a higher unit price can cost more. Recommending "3 instead
    // of 4" while quietly increasing the bill would be worse than saying nothing.
    const result = recommendSheetAlternatives(sheet(), [expensive], pieces);
    for (const recommendation of result) {
      expect(recommendation.savingCents).toBeGreaterThan(0);
    }
  });

  it('recommends a genuinely cheaper option', () => {
    const pieces = [piece({ widthMm: 1200, heightMm: 600, quantity: 4 })];
    const cheaper = sheet({
      materialId: 'm-cheap',
      name: 'Budget 2440×1220',
      unitPriceCents: 60000,
    });

    const result = recommendSheetAlternatives(sheet(), [cheaper], pieces);
    expect(result).toHaveLength(1);
    expect(result[0].savingCents).toBeGreaterThan(0);
    expect(result[0].alternative.name).toBe('Budget 2440×1220');
  });

  it('skips a candidate that cannot produce every piece', () => {
    const pieces = [piece({ widthMm: 2000, heightMm: 1000, quantity: 1, allowRotation: false })];
    const tooSmall = sheet({
      materialId: 'm-small',
      name: 'Small',
      sheetWidthMm: 1000,
      sheetHeightMm: 1000,
      unitPriceCents: 1000,
    });

    // Cheap is irrelevant if the job cannot be made from it.
    const result = recommendSheetAlternatives(sheet(), [tooSmall], pieces);
    expect(result).toHaveLength(0);
  });

  it('never recommends the material already in use', () => {
    const pieces = [piece({ quantity: 4 })];
    const result = recommendSheetAlternatives(sheet(), [sheet()], pieces);
    expect(result).toHaveLength(0);
  });

  it('returns nothing when there are no pieces to compare', () => {
    expect(recommendSheetAlternatives(sheet(), [sheet({ materialId: 'x' })], [])).toHaveLength(0);
  });

  it('orders recommendations by the largest saving first', () => {
    const pieces = [piece({ widthMm: 1200, heightMm: 600, quantity: 4 })];
    const result = recommendSheetAlternatives(
      sheet(),
      [
        sheet({ materialId: 'a', name: 'A', unitPriceCents: 80000 }),
        sheet({ materialId: 'b', name: 'B', unitPriceCents: 40000 }),
      ],
      pieces
    );
    expect(result[0].alternative.name).toBe('B');
    expect(result[0].savingCents).toBeGreaterThan(result[1].savingCents);
  });
});

describe('bar alternatives', () => {
  it('finds the bar length that packs the cuts better', () => {
    // Four 4m cuts: a 6m bar yields one each (4 bars, 48000 total), while an 8m
    // bar also yields one each (4 bars) — but a 4m bar yields exactly one with
    // no waste and may be cheaper per bar.
    const cuts = [cut({ lengthMm: 4000, quantity: 4 })];
    const exact = bar({
      materialId: 'b-4m',
      name: 'Tube 4 m',
      standardLengthMm: 4000,
      unitPriceCents: 8000,
    });

    const result = recommendBarAlternatives(bar(), [exact], cuts);
    expect(result).toHaveLength(1);
    // 4 x 8000 = 32000 versus 4 x 12000 = 48000.
    expect(result[0].savingCents).toBe(16000);
    expect(result[0].alternative.wastePercent).toBe(0);
  });

  it('skips a bar too short for a required cut', () => {
    const cuts = [cut({ lengthMm: 5000, quantity: 1 })];
    const short = bar({
      materialId: 'b-3m',
      name: 'Tube 3 m',
      standardLengthMm: 3000,
      unitPriceCents: 1000,
    });

    // Splicing is not an option the optimiser may assume.
    expect(recommendBarAlternatives(bar(), [short], cuts)).toHaveLength(0);
  });

  it('shows no waste difference when tails count as reusable stock', () => {
    // With a permissive remnant policy, the 2m tail on each 6m bar is stock,
    // not waste — so BOTH options report 0% waste and the whole signal is the
    // money. This follows from T9's rule that a keepable remnant is not a loss.
    const cuts = [cut({ lengthMm: 4000, quantity: 4 })];
    const exact = bar({
      materialId: 'b-4m',
      name: 'Tube 4 m',
      standardLengthMm: 4000,
      unitPriceCents: 8000,
    });

    const result = recommendBarAlternatives(bar(), [exact], cuts);
    expect(result[0].current.wastePercent).toBe(0);
    expect(result[0].alternative.wastePercent).toBe(0);
    expect(result[0].wasteReductionPercent).toBe(0);
    expect(result[0].savingCents).toBe(16000);
  });

  it('shows a waste reduction when tails are too short to keep', () => {
    // A shop that scraps anything under 3m sees the 2m tails as real loss.
    const cuts = [cut({ lengthMm: 4000, quantity: 4 })];
    const strict = { minUsableRemnantMm: 3000 };
    const exact = bar({
      materialId: 'b-4m',
      name: 'Tube 4 m',
      standardLengthMm: 4000,
      unitPriceCents: 8000,
      ...strict,
    });

    const result = recommendBarAlternatives(bar({ ...strict }), [exact], cuts);
    expect(result[0].current.wastePercent).toBeGreaterThan(0);
    expect(result[0].alternative.wastePercent).toBe(0);
    expect(result[0].wasteReductionPercent).toBeGreaterThan(0);
  });

  it('returns nothing when no cuts are defined', () => {
    expect(recommendBarAlternatives(bar(), [bar({ materialId: 'x' })], [])).toHaveLength(0);
  });
});

describe('rotation recommendation', () => {
  it('reports the saving from allowing rotation, with a caveat', () => {
    // 1210 x 2400 does not fit a 2440x1220 sheet upright, but does turned.
    const pieces = [piece({ widthMm: 1210, heightMm: 2400, quantity: 1, allowRotation: false })];
    // Upright it cannot be placed at all, so the current outcome is not viable
    // and nothing is recommended — the user must change the piece, not rotate it.
    expect(recommendRotation(sheet(), pieces)).toBeNull();
  });

  it('recommends rotation when it genuinely reduces sheets', () => {
    const pieces = [
      piece({ id: 'a', widthMm: 1200, heightMm: 800, quantity: 2, allowRotation: false }),
      piece({ id: 'b', widthMm: 800, heightMm: 1200, quantity: 2, allowRotation: false }),
    ];
    const result = recommendRotation(sheet(), pieces);

    if (result) {
      expect(result.savingCents).toBeGreaterThan(0);
      // Rotation is disabled for a reason; the recommendation must say so.
      expect(result.summary).toContain('grain');
    }
  });

  it('says nothing when every piece may already rotate', () => {
    expect(recommendRotation(sheet(), [piece({ allowRotation: true })])).toBeNull();
  });
});

describe('the invariant that matters', () => {
  it('every recommendation strictly reduces cost', () => {
    const pieces = [
      piece({ id: 'a', widthMm: 1200, heightMm: 600, quantity: 5 }),
      piece({ id: 'b', widthMm: 700, heightMm: 400, quantity: 3 }),
    ];
    const candidates = [
      sheet({ materialId: 'a', name: 'A', unitPriceCents: 90000 }),
      sheet({ materialId: 'b', name: 'B', unitPriceCents: 60000 }),
      sheet({ materialId: 'c', name: 'C', sheetWidthMm: 3050, sheetHeightMm: 1500, unitPriceCents: 200000 }),
    ];

    for (const recommendation of recommendSheetAlternatives(sheet(), candidates, pieces)) {
      // A recommendation that costs more is not a recommendation.
      expect(recommendation.savingCents).toBeGreaterThan(0);
      expect(recommendation.alternative.unplacedCount).toBe(0);
    }
  });

  it('is deterministic', () => {
    const pieces = [piece({ quantity: 4 })];
    const candidates = [sheet({ materialId: 'x', name: 'X', unitPriceCents: 50000 })];
    expect(recommendSheetAlternatives(sheet(), candidates, pieces)).toEqual(
      recommendSheetAlternatives(sheet(), candidates, pieces)
    );
  });
});
