/**
 * Deterministic 2D sheet nesting.
 *
 * # Guillotine, not free nesting
 *
 * Every cut runs edge to edge across the region being divided, which is what a
 * panel saw physically does. Free nesting packs tighter, but a free-nested
 * layout cannot be produced on a panel saw at all — whereas a guillotine layout
 * cuts fine on both a saw and a CNC router. The extra waste buys a plan that
 * every workshop can actually execute.
 *
 * # Integer millimetres
 *
 * As with the material and cost engines, all arithmetic is integer. A
 * floating-point remainder deciding whether a piece "just fits" would change
 * how many sheets someone buys.
 *
 * # Kerf
 *
 * The blade removes material. Every cut consumes `kerfMm`, so a piece placed
 * next to another needs its own width PLUS the kerf before the next piece can
 * start. Ignoring kerf is the classic way a cutting plan that looks fine on
 * paper comes up short on the last piece of the sheet.
 */

export type CuttingPieceInput = {
  id: string;
  label?: string | null;
  widthMm: number;
  heightMm: number;
  quantity: number;
  /** False for materials with a grain or print direction. */
  allowRotation: boolean;
};

export type CuttingSettings = {
  sheetWidthMm: number;
  sheetHeightMm: number;
  /** Blade width consumed by each cut. */
  kerfMm: number;
  /** Unusable trim around the sheet edge. */
  edgeMarginMm: number;
};

export type PlacedPiece = {
  pieceId: string;
  label: string | null;
  x: number;
  y: number;
  widthMm: number;
  heightMm: number;
  /** True when the piece was turned 90° to fit. */
  rotated: boolean;
};

export type SheetLayout = {
  index: number;
  pieces: PlacedPiece[];
  /** Rectangles of usable material left over on this sheet. */
  offcuts: { x: number; y: number; widthMm: number; heightMm: number }[];
};

export type UnplacedPiece = {
  pieceId: string;
  label: string | null;
  widthMm: number;
  heightMm: number;
  quantity: number;
  reason: string;
};

export type CuttingResult = {
  sheets: SheetLayout[];
  sheetsUsed: number;
  unplaced: UnplacedPiece[];
  /** Total area of all placed pieces, mm². */
  usedAreaMm2: number;
  /** Total area of every sheet purchased, mm². */
  purchasedAreaMm2: number;
  wastePercent: number;
  settings: CuttingSettings;
};

/** A free rectangle available for cutting. */
type FreeRect = { x: number; y: number; widthMm: number; heightMm: number };

type Instance = {
  pieceId: string;
  label: string | null;
  widthMm: number;
  heightMm: number;
  allowRotation: boolean;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Splits a free rectangle after placing a piece in its top-left corner.
 *
 * This is where the guillotine constraint lives: the remainder is divided by
 * ONE straight cut running the full width or height, producing exactly two
 * rectangles. Free nesting would instead keep an L-shaped remainder, which no
 * panel saw can cut.
 *
 * The split direction is chosen to leave the larger single usable rectangle,
 * which in practice keeps big offcuts intact rather than shredding a sheet into
 * slivers.
 */
function splitFreeRect(rect: FreeRect, usedWidth: number, usedHeight: number, kerfMm: number): FreeRect[] {
  const rightWidth = rect.widthMm - usedWidth - kerfMm;
  const bottomHeight = rect.heightMm - usedHeight - kerfMm;

  const results: FreeRect[] = [];

  // Horizontal split: the cut runs the full width of the rectangle.
  const horizontalRight = rightWidth > 0 ? rightWidth * usedHeight : 0;
  const horizontalBottom = bottomHeight > 0 ? bottomHeight * rect.widthMm : 0;
  // Vertical split: the cut runs the full height.
  const verticalRight = rightWidth > 0 ? rightWidth * rect.heightMm : 0;
  const verticalBottom = bottomHeight > 0 ? bottomHeight * usedWidth : 0;

  const preferHorizontal =
    Math.max(horizontalRight, horizontalBottom) >= Math.max(verticalRight, verticalBottom);

  if (preferHorizontal) {
    if (rightWidth > 0) {
      results.push({
        x: rect.x + usedWidth + kerfMm,
        y: rect.y,
        widthMm: rightWidth,
        heightMm: usedHeight,
      });
    }
    if (bottomHeight > 0) {
      results.push({
        x: rect.x,
        y: rect.y + usedHeight + kerfMm,
        widthMm: rect.widthMm,
        heightMm: bottomHeight,
      });
    }
  } else {
    if (rightWidth > 0) {
      results.push({
        x: rect.x + usedWidth + kerfMm,
        y: rect.y,
        widthMm: rightWidth,
        heightMm: rect.heightMm,
      });
    }
    if (bottomHeight > 0) {
      results.push({
        x: rect.x,
        y: rect.y + usedHeight + kerfMm,
        widthMm: usedWidth,
        heightMm: bottomHeight,
      });
    }
  }

  return results;
}

/** Best-area-fit: the smallest free rectangle the piece fits into, to avoid
 *  consuming a large offcut for a small piece. */
function findBestFit(
  freeRects: FreeRect[],
  piece: Instance
): { index: number; rotated: boolean } | null {
  type Candidate = { index: number; rotated: boolean; waste: number };
  // A plain loop rather than forEach: TypeScript does not track assignments made
  // inside a callback, and narrows the accumulator to null.
  let best: Candidate | null = null;

  for (let index = 0; index < freeRects.length; index += 1) {
    const rect = freeRects[index];
    const orientations: { w: number; h: number; rotated: boolean }[] = [
      { w: piece.widthMm, h: piece.heightMm, rotated: false },
    ];
    if (piece.allowRotation && piece.widthMm !== piece.heightMm) {
      orientations.push({ w: piece.heightMm, h: piece.widthMm, rotated: true });
    }

    for (const orientation of orientations) {
      if (orientation.w > rect.widthMm || orientation.h > rect.heightMm) continue;
      const waste = rect.widthMm * rect.heightMm - orientation.w * orientation.h;
      if (best === null || waste < best.waste) {
        best = { index, rotated: orientation.rotated, waste };
      }
    }
  }

  return best === null ? null : { index: best.index, rotated: best.rotated };
}

export function calculateCuttingPlan(
  pieces: CuttingPieceInput[],
  settings: CuttingSettings
): CuttingResult {
  const { sheetWidthMm, sheetHeightMm, kerfMm, edgeMarginMm } = settings;

  // The usable area is the sheet minus trim on all four edges.
  const usableWidth = sheetWidthMm - edgeMarginMm * 2;
  const usableHeight = sheetHeightMm - edgeMarginMm * 2;

  const emptyResult = (unplaced: UnplacedPiece[]): CuttingResult => ({
    sheets: [],
    sheetsUsed: 0,
    unplaced,
    usedAreaMm2: 0,
    purchasedAreaMm2: 0,
    wastePercent: 0,
    settings,
  });

  if (usableWidth <= 0 || usableHeight <= 0) {
    return emptyResult(
      pieces.map((piece) => ({
        pieceId: piece.id,
        label: piece.label ?? null,
        widthMm: piece.widthMm,
        heightMm: piece.heightMm,
        quantity: piece.quantity,
        reason: 'The edge margin leaves no usable area on this sheet size.',
      }))
    );
  }

  // Expand quantities into individual instances, then sort largest first.
  // Placing big pieces before small ones is what makes a greedy packer produce
  // sensible layouts — small pieces fill gaps the large ones leave.
  const instances: Instance[] = [];
  const unplaced: UnplacedPiece[] = [];

  for (const piece of pieces) {
    const fitsNormally = piece.widthMm <= usableWidth && piece.heightMm <= usableHeight;
    const fitsRotated =
      piece.allowRotation && piece.heightMm <= usableWidth && piece.widthMm <= usableHeight;

    if (!fitsNormally && !fitsRotated) {
      // Refused outright rather than split. Deciding where to seam a piece too
      // big for the sheet is a fabrication decision, not an optimisation.
      unplaced.push({
        pieceId: piece.id,
        label: piece.label ?? null,
        widthMm: piece.widthMm,
        heightMm: piece.heightMm,
        quantity: piece.quantity,
        reason: `Larger than the usable sheet area (${usableWidth} × ${usableHeight} mm after edge margin).`,
      });
      continue;
    }

    for (let i = 0; i < piece.quantity; i += 1) {
      instances.push({
        pieceId: piece.id,
        label: piece.label ?? null,
        widthMm: piece.widthMm,
        heightMm: piece.heightMm,
        allowRotation: piece.allowRotation,
      });
    }
  }

  instances.sort((a, b) => {
    const areaDiff = b.widthMm * b.heightMm - a.widthMm * a.heightMm;
    if (areaDiff !== 0) return areaDiff;
    // Deterministic tie-break so the same input always yields the same layout.
    const longestDiff = Math.max(b.widthMm, b.heightMm) - Math.max(a.widthMm, a.heightMm);
    if (longestDiff !== 0) return longestDiff;
    return a.pieceId.localeCompare(b.pieceId);
  });

  const sheets: SheetLayout[] = [];
  const freeBySheet: FreeRect[][] = [];
  let usedAreaMm2 = 0;

  for (const instance of instances) {
    let placed = false;

    for (let sheetIndex = 0; sheetIndex < sheets.length && !placed; sheetIndex += 1) {
      const fit = findBestFit(freeBySheet[sheetIndex], instance);
      if (!fit) continue;

      const rect = freeBySheet[sheetIndex][fit.index];
      const width = fit.rotated ? instance.heightMm : instance.widthMm;
      const height = fit.rotated ? instance.widthMm : instance.heightMm;

      sheets[sheetIndex].pieces.push({
        pieceId: instance.pieceId,
        label: instance.label,
        x: rect.x,
        y: rect.y,
        widthMm: width,
        heightMm: height,
        rotated: fit.rotated,
      });
      usedAreaMm2 += width * height;

      freeBySheet[sheetIndex].splice(fit.index, 1, ...splitFreeRect(rect, width, height, kerfMm));
      placed = true;
    }

    if (!placed) {
      // Open a new sheet. The piece is known to fit one, checked above.
      const index = sheets.length;
      sheets.push({ index, pieces: [], offcuts: [] });
      freeBySheet.push([
        { x: edgeMarginMm, y: edgeMarginMm, widthMm: usableWidth, heightMm: usableHeight },
      ]);

      const fit = findBestFit(freeBySheet[index], instance);
      if (!fit) continue;

      const rect = freeBySheet[index][fit.index];
      const width = fit.rotated ? instance.heightMm : instance.widthMm;
      const height = fit.rotated ? instance.widthMm : instance.heightMm;

      sheets[index].pieces.push({
        pieceId: instance.pieceId,
        label: instance.label,
        x: rect.x,
        y: rect.y,
        widthMm: width,
        heightMm: height,
        rotated: fit.rotated,
      });
      usedAreaMm2 += width * height;

      freeBySheet[index].splice(fit.index, 1, ...splitFreeRect(rect, width, height, kerfMm));
    }
  }

  // Remaining free rectangles are reported as offcuts — usable material the
  // workshop can keep rather than scrap.
  sheets.forEach((sheet, index) => {
    sheet.offcuts = freeBySheet[index]
      .filter((rect) => rect.widthMm > 0 && rect.heightMm > 0)
      .sort((a, b) => b.widthMm * b.heightMm - a.widthMm * a.heightMm);
  });

  const purchasedAreaMm2 = sheets.length * sheetWidthMm * sheetHeightMm;
  const wastePercent =
    purchasedAreaMm2 === 0 ? 0 : round2(((purchasedAreaMm2 - usedAreaMm2) / purchasedAreaMm2) * 100);

  return {
    sheets,
    sheetsUsed: sheets.length,
    unplaced,
    usedAreaMm2,
    purchasedAreaMm2,
    wastePercent,
    settings,
  };
}
