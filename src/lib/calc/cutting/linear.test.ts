import { describe, expect, it } from 'vitest';
import { calculateLinearPlan, type LinearCutInput, type LinearSettings } from './linear';

const bars = (overrides: Partial<LinearSettings> = {}): LinearSettings => ({
  stockLengthMm: 6000,
  kerfMm: 0,
  minUsableRemnantMm: 0,
  ...overrides,
});

const cut = (overrides: Partial<LinearCutInput> = {}): LinearCutInput => ({
  id: 'c1',
  label: 'Upright',
  lengthMm: 2000,
  quantity: 1,
  ...overrides,
});

/** No bar may hold more than its own length, counting kerf. */
function assertBarsWithinLength(result: ReturnType<typeof calculateLinearPlan>) {
  for (const bar of result.bars) {
    expect(bar.usedMm + bar.kerfMm).toBeLessThanOrEqual(result.settings.stockLengthMm);
    expect(bar.remnantMm).toBeGreaterThanOrEqual(0);
  }
}

/** Cuts on a bar must not overlap. */
function assertNoOverlaps(result: ReturnType<typeof calculateLinearPlan>) {
  for (const bar of result.bars) {
    const sorted = [...bar.cuts].sort((a, b) => a.offsetMm - b.offsetMm);
    for (let i = 1; i < sorted.length; i += 1) {
      const previousEnd = sorted[i - 1].offsetMm + sorted[i - 1].lengthMm;
      expect(sorted[i].offsetMm).toBeGreaterThanOrEqual(previousEnd);
    }
  }
}

describe('the case a length division gets wrong', () => {
  it('needs four bars for four 4m cuts from 6m stock, not three', () => {
    // 16m of material divided by 6m suggests three bars, but only ONE 4m piece
    // fits per bar. Under-buying stops a job mid-fabrication.
    const result = calculateLinearPlan([cut({ lengthMm: 4000, quantity: 4 })], bars());

    expect(result.barsUsed).toBe(4);
    expect(result.totalRequiredMm).toBe(16000);
    // A naive division would have said 3.
    expect(Math.ceil(result.totalRequiredMm / 6000)).toBe(3);
  });

  it('matches the division when cuts happen to pack perfectly', () => {
    // Three 2m cuts fill a 6m bar exactly.
    const result = calculateLinearPlan([cut({ lengthMm: 2000, quantity: 6 })], bars());
    expect(result.barsUsed).toBe(2);
    expect(result.wastePercent).toBe(0);
  });
});

describe('placement', () => {
  it('places a single cut on one bar', () => {
    const result = calculateLinearPlan([cut()], bars());
    expect(result.barsUsed).toBe(1);
    expect(result.bars[0].cuts).toHaveLength(1);
  });

  it('fills a bar before opening another', () => {
    const result = calculateLinearPlan([cut({ lengthMm: 1500, quantity: 4 })], bars());
    expect(result.barsUsed).toBe(1);
    expect(result.bars[0].cuts).toHaveLength(4);
  });

  it('never overlaps cuts and never exceeds the bar', () => {
    const result = calculateLinearPlan(
      [
        cut({ id: 'a', lengthMm: 2500, quantity: 3 }),
        cut({ id: 'b', lengthMm: 1200, quantity: 5 }),
        cut({ id: 'c', lengthMm: 800, quantity: 4 }),
      ],
      bars({ kerfMm: 3 })
    );
    assertBarsWithinLength(result);
    assertNoOverlaps(result);
  });

  it('places long pieces first so short ones fill the tails', () => {
    const result = calculateLinearPlan(
      [cut({ id: 'short', lengthMm: 500, quantity: 2 }), cut({ id: 'long', lengthMm: 5000, quantity: 1 })],
      bars()
    );
    // The 5m piece and both 500mm pieces fit one 6m bar only if the long one is
    // placed first.
    expect(result.barsUsed).toBe(1);
  });

  it('is deterministic', () => {
    const input = [cut({ id: 'a', lengthMm: 2000, quantity: 3 }), cut({ id: 'b', lengthMm: 1000, quantity: 2 })];
    expect(calculateLinearPlan(input, bars())).toEqual(calculateLinearPlan(input, bars()));
  });
});

describe('kerf', () => {
  it('charges blade width between cuts but not after the last one', () => {
    // Three 2000mm cuts exactly fill a 6000mm bar with no kerf. With a 5mm
    // blade, two cuts (2 x 5mm) still fit; the third does not.
    const noKerf = calculateLinearPlan([cut({ lengthMm: 2000, quantity: 3 })], bars({ kerfMm: 0 }));
    expect(noKerf.barsUsed).toBe(1);

    const withKerf = calculateLinearPlan([cut({ lengthMm: 2000, quantity: 3 })], bars({ kerfMm: 5 }));
    expect(withKerf.barsUsed).toBe(2);
  });

  it('does not charge kerf for the first cut on a bar', () => {
    // Charging it unconditionally would waste a blade width per bar and inflate
    // the bar count.
    const result = calculateLinearPlan([cut({ lengthMm: 6000, quantity: 1 })], bars({ kerfMm: 5 }));
    expect(result.barsUsed).toBe(1);
    expect(result.bars[0].kerfMm).toBe(0);
  });

  it('counts kerf as waste', () => {
    const result = calculateLinearPlan([cut({ lengthMm: 1000, quantity: 3 })], bars({ kerfMm: 10, minUsableRemnantMm: 100000 }));
    expect(result.totalKerfMm).toBe(20);
    expect(result.wasteMm).toBeGreaterThanOrEqual(20);
  });
});

describe('remnants', () => {
  it('treats a long tail as reusable stock, not waste', () => {
    // One 4m cut from a 6m bar leaves 2m — plainly worth keeping.
    const result = calculateLinearPlan(
      [cut({ lengthMm: 4000, quantity: 1 })],
      bars({ minUsableRemnantMm: 300 })
    );
    expect(result.bars[0].remnantUsable).toBe(true);
    expect(result.usableRemnantsMm).toEqual([2000]);
    // Counting a keepable remnant as waste would overstate the cost of the job.
    expect(result.wastePercent).toBe(0);
  });

  it('treats a short tail as scrap', () => {
    const result = calculateLinearPlan(
      [cut({ lengthMm: 5900, quantity: 1 })],
      bars({ minUsableRemnantMm: 300 })
    );
    expect(result.bars[0].remnantUsable).toBe(false);
    expect(result.wasteMm).toBe(100);
  });

  it('counts every tail as waste when the threshold is zero-length', () => {
    const result = calculateLinearPlan(
      [cut({ lengthMm: 4000, quantity: 1 })],
      bars({ minUsableRemnantMm: 100000 })
    );
    expect(result.usableRemnantsMm).toEqual([]);
    expect(result.wasteMm).toBe(2000);
  });

  it('reports utilisation per bar', () => {
    const result = calculateLinearPlan([cut({ lengthMm: 3000, quantity: 1 })], bars());
    expect(result.bars[0].utilisationPercent).toBe(50);
  });
});

describe('oversized cuts', () => {
  it('reports a cut longer than the bar instead of splicing', () => {
    const result = calculateLinearPlan(
      [cut({ lengthMm: 8000, quantity: 2, label: 'Full span' })],
      bars()
    );
    // Joining two bars to make one long piece is a decision about joints and
    // strength, not an optimisation.
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0].reason).toContain('Longer than');
    expect(result.barsUsed).toBe(0);
  });

  it('still plans the cuts that do fit', () => {
    const result = calculateLinearPlan(
      [cut({ id: 'big', lengthMm: 8000 }), cut({ id: 'ok', lengthMm: 2000 })],
      bars()
    );
    expect(result.unplaced.map((u) => u.cutId)).toEqual(['big']);
    expect(result.bars[0].cuts[0].cutId).toBe('ok');
  });

  it('accepts a cut exactly the length of the bar', () => {
    const result = calculateLinearPlan([cut({ lengthMm: 6000 })], bars());
    expect(result.barsUsed).toBe(1);
    expect(result.unplaced).toHaveLength(0);
  });
});

describe('empty input', () => {
  it('produces nothing rather than an empty bar', () => {
    const result = calculateLinearPlan([], bars());
    expect(result.barsUsed).toBe(0);
    expect(result.wastePercent).toBe(0);
    expect(result.totalPurchasedMm).toBe(0);
  });
});
