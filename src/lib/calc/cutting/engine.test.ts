import { describe, expect, it } from 'vitest';
import { calculateCuttingPlan, type CuttingPieceInput, type CuttingSettings } from './engine';

/** A standard alucobond sheet. */
const sheet = (overrides: Partial<CuttingSettings> = {}): CuttingSettings => ({
  sheetWidthMm: 2440,
  sheetHeightMm: 1220,
  kerfMm: 0,
  edgeMarginMm: 0,
  ...overrides,
});

const piece = (overrides: Partial<CuttingPieceInput> = {}): CuttingPieceInput => ({
  id: 'p1',
  label: 'Panel',
  widthMm: 1000,
  heightMm: 500,
  quantity: 1,
  allowRotation: true,
  ...overrides,
});

/** No two placed pieces may overlap — the invariant that matters most. */
function assertNoOverlaps(result: ReturnType<typeof calculateCuttingPlan>) {
  for (const sheetLayout of result.sheets) {
    const placed = sheetLayout.pieces;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        const overlaps =
          a.x < b.x + b.widthMm &&
          b.x < a.x + a.widthMm &&
          a.y < b.y + b.heightMm &&
          b.y < a.y + a.heightMm;
        expect(overlaps, `pieces ${i} and ${j} overlap on sheet ${sheetLayout.index}`).toBe(false);
      }
    }
  }
}

/** Every piece must sit inside the sheet, respecting the edge margin. */
function assertWithinBounds(result: ReturnType<typeof calculateCuttingPlan>) {
  const { sheetWidthMm, sheetHeightMm, edgeMarginMm } = result.settings;
  for (const sheetLayout of result.sheets) {
    for (const p of sheetLayout.pieces) {
      expect(p.x).toBeGreaterThanOrEqual(edgeMarginMm);
      expect(p.y).toBeGreaterThanOrEqual(edgeMarginMm);
      expect(p.x + p.widthMm).toBeLessThanOrEqual(sheetWidthMm - edgeMarginMm);
      expect(p.y + p.heightMm).toBeLessThanOrEqual(sheetHeightMm - edgeMarginMm);
    }
  }
}

describe('basic placement', () => {
  it('places a single piece on one sheet', () => {
    const result = calculateCuttingPlan([piece()], sheet());
    expect(result.sheetsUsed).toBe(1);
    expect(result.sheets[0].pieces).toHaveLength(1);
    expect(result.unplaced).toHaveLength(0);
  });

  it('expands quantity into separate placements', () => {
    const result = calculateCuttingPlan([piece({ quantity: 4 })], sheet());
    const total = result.sheets.reduce((sum, s) => sum + s.pieces.length, 0);
    expect(total).toBe(4);
    assertNoOverlaps(result);
  });

  it('never overlaps pieces, however many are packed', () => {
    const result = calculateCuttingPlan(
      [
        piece({ id: 'a', widthMm: 800, heightMm: 600, quantity: 5 }),
        piece({ id: 'b', widthMm: 400, heightMm: 300, quantity: 7 }),
        piece({ id: 'c', widthMm: 1200, heightMm: 500, quantity: 2 }),
      ],
      sheet()
    );
    assertNoOverlaps(result);
    assertWithinBounds(result);
  });

  it('opens additional sheets when one is full', () => {
    // Four 1220x1220 pieces cannot share a 2440x1220 sheet more than two at a time.
    const result = calculateCuttingPlan(
      [piece({ widthMm: 1220, heightMm: 1220, quantity: 4, allowRotation: false })],
      sheet()
    );
    expect(result.sheetsUsed).toBe(2);
    assertNoOverlaps(result);
  });

  it('is deterministic — identical input gives an identical layout', () => {
    const input = [
      piece({ id: 'a', widthMm: 900, heightMm: 400, quantity: 3 }),
      piece({ id: 'b', widthMm: 600, heightMm: 600, quantity: 2 }),
    ];
    expect(calculateCuttingPlan(input, sheet())).toEqual(calculateCuttingPlan(input, sheet()));
  });
});

describe('edge margin', () => {
  it('keeps every piece inside the trimmed area', () => {
    const result = calculateCuttingPlan([piece({ quantity: 6 })], sheet({ edgeMarginMm: 20 }));
    assertWithinBounds(result);
    for (const p of result.sheets[0].pieces) {
      expect(p.x).toBeGreaterThanOrEqual(20);
    }
  });

  it('refuses a piece that only fits without the margin', () => {
    // Exactly sheet-sized, so any trim makes it impossible.
    const result = calculateCuttingPlan(
      [piece({ widthMm: 2440, heightMm: 1220, allowRotation: false })],
      sheet({ edgeMarginMm: 10 })
    );
    expect(result.unplaced).toHaveLength(1);
    expect(result.sheetsUsed).toBe(0);
  });

  it('reports everything unplaced when the margin consumes the sheet', () => {
    const result = calculateCuttingPlan([piece()], sheet({ edgeMarginMm: 700 }));
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0].reason).toContain('no usable area');
  });
});

describe('kerf', () => {
  it('leaves blade width between neighbouring pieces', () => {
    // Two 1220-wide pieces exactly fill a 2440 sheet with no kerf, but cannot
    // once the blade takes its cut.
    const noKerf = calculateCuttingPlan(
      [piece({ widthMm: 1220, heightMm: 1220, quantity: 2, allowRotation: false })],
      sheet({ kerfMm: 0 })
    );
    expect(noKerf.sheetsUsed).toBe(1);

    const withKerf = calculateCuttingPlan(
      [piece({ widthMm: 1220, heightMm: 1220, quantity: 2, allowRotation: false })],
      sheet({ kerfMm: 4 })
    );
    // Ignoring kerf is how a plan that looks fine on paper comes up short on
    // the last piece of the sheet.
    expect(withKerf.sheetsUsed).toBe(2);
  });

  it('never lets kerf create an overlap', () => {
    const result = calculateCuttingPlan(
      [piece({ widthMm: 700, heightMm: 400, quantity: 8 })],
      sheet({ kerfMm: 5 })
    );
    assertNoOverlaps(result);
  });
});

describe('rotation', () => {
  it('turns a piece 90° when that is the only way it fits', () => {
    // 1210 wide x 2400 tall does not fit a 2440x1220 sheet upright.
    const result = calculateCuttingPlan(
      [piece({ widthMm: 1210, heightMm: 2400, allowRotation: true })],
      sheet()
    );
    expect(result.sheetsUsed).toBe(1);
    expect(result.sheets[0].pieces[0].rotated).toBe(true);
  });

  it('refuses to rotate a piece with a grain direction', () => {
    const result = calculateCuttingPlan(
      [piece({ widthMm: 1210, heightMm: 2400, allowRotation: false })],
      sheet()
    );
    // Turning a directional material would spoil the piece, so it is reported
    // rather than quietly rotated.
    expect(result.unplaced).toHaveLength(1);
    expect(result.sheetsUsed).toBe(0);
  });
});

describe('oversized pieces', () => {
  it('reports a piece larger than the sheet instead of splitting it', () => {
    const result = calculateCuttingPlan(
      [piece({ widthMm: 8000, heightMm: 3000, label: 'Full facade' })],
      sheet()
    );
    // Deciding where to seam an oversized panel is a fabrication decision with
    // joins and edges — not something an optimiser may invent.
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0].reason).toContain('Larger than the usable sheet area');
    expect(result.sheetsUsed).toBe(0);
  });

  it('still places the pieces that do fit', () => {
    const result = calculateCuttingPlan(
      [piece({ id: 'big', widthMm: 8000, heightMm: 3000 }), piece({ id: 'ok', widthMm: 500, heightMm: 500 })],
      sheet()
    );
    expect(result.unplaced.map((u) => u.pieceId)).toEqual(['big']);
    expect(result.sheets[0].pieces.map((p) => p.pieceId)).toEqual(['ok']);
  });
});

describe('waste and offcuts', () => {
  it('computes waste against the full purchased area', () => {
    // One 1220x1220 piece on a 2440x1220 sheet uses exactly half.
    const result = calculateCuttingPlan(
      [piece({ widthMm: 1220, heightMm: 1220, allowRotation: false })],
      sheet()
    );
    expect(result.wastePercent).toBeCloseTo(50, 1);
    expect(result.purchasedAreaMm2).toBe(2440 * 1220);
  });

  it('reports zero waste when a sheet is filled exactly', () => {
    const result = calculateCuttingPlan(
      [piece({ widthMm: 1220, heightMm: 1220, quantity: 2, allowRotation: false })],
      sheet()
    );
    expect(result.wastePercent).toBe(0);
  });

  it('reports usable offcuts rather than treating the remainder as scrap', () => {
    const result = calculateCuttingPlan(
      [piece({ widthMm: 1000, heightMm: 500, allowRotation: false })],
      sheet()
    );
    expect(result.sheets[0].offcuts.length).toBeGreaterThan(0);
    // Largest first, so the workshop sees the most reusable piece.
    const areas = result.sheets[0].offcuts.map((o) => o.widthMm * o.heightMm);
    expect(areas).toEqual([...areas].sort((a, b) => b - a));
  });

  it('produces no sheets and no waste for an empty piece list', () => {
    const result = calculateCuttingPlan([], sheet());
    expect(result.sheetsUsed).toBe(0);
    expect(result.wastePercent).toBe(0);
  });
});

describe('guillotine constraint', () => {
  it('produces offcuts that are rectangles, never L-shapes', () => {
    const result = calculateCuttingPlan(
      [piece({ id: 'a', widthMm: 900, heightMm: 400, quantity: 4 })],
      sheet()
    );
    // Every free region is stored as a rectangle by construction; an L-shaped
    // remainder would mean the layout needs a cut no panel saw can make.
    for (const offcut of result.sheets.flatMap((s) => s.offcuts)) {
      expect(offcut.widthMm).toBeGreaterThan(0);
      expect(offcut.heightMm).toBeGreaterThan(0);
    }
    assertNoOverlaps(result);
  });

  it('keeps offcuts from overlapping placed pieces', () => {
    const result = calculateCuttingPlan([piece({ quantity: 3 })], sheet({ kerfMm: 3 }));
    for (const layout of result.sheets) {
      for (const offcut of layout.offcuts) {
        for (const p of layout.pieces) {
          const overlaps =
            offcut.x < p.x + p.widthMm &&
            p.x < offcut.x + offcut.widthMm &&
            offcut.y < p.y + p.heightMm &&
            p.y < offcut.y + offcut.heightMm;
          expect(overlaps).toBe(false);
        }
      }
    }
  });
});
