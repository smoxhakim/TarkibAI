import type { CuttingResult, SheetLayout } from './engine';

/**
 * Renders a cutting layout to SVG.
 *
 * Pure and deterministic, like the canvas renderer, because this diagram goes
 * into the production document a workshop cuts from — it must be reproducible
 * from the stored plan rather than regenerated differently each time.
 *
 * Colours are literal rather than CSS variables here: the same markup is
 * rasterised to PNG server-side for PDFs, where no stylesheet exists.
 */
const COLOURS = {
  sheet: '#ffffff',
  sheetEdge: '#1f2937',
  margin: '#e5e7eb',
  piece: '#dbeafe',
  pieceEdge: '#1d4ed8',
  offcut: '#f3f4f6',
  offcutEdge: '#9ca3af',
  text: '#111827',
  mutedText: '#6b7280',
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderSheet(
  sheet: SheetLayout,
  result: CuttingResult,
  offsetY: number,
  fontSize: number,
  strokeWidth: number
): string {
  const { sheetWidthMm, sheetHeightMm, edgeMarginMm } = result.settings;
  const parts: string[] = [];

  parts.push(
    `<text x="0" y="${offsetY - fontSize * 0.6}" font-size="${fontSize}" fill="${COLOURS.text}" font-weight="600">` +
      `Sheet ${sheet.index + 1} of ${result.sheetsUsed}</text>`
  );

  parts.push(
    `<rect x="0" y="${offsetY}" width="${sheetWidthMm}" height="${sheetHeightMm}" ` +
      `fill="${COLOURS.sheet}" stroke="${COLOURS.sheetEdge}" stroke-width="${strokeWidth * 1.5}" />`
  );

  // The trimmed edge, drawn so the cutter can see what is unusable.
  if (edgeMarginMm > 0) {
    parts.push(
      `<rect x="${edgeMarginMm}" y="${offsetY + edgeMarginMm}" ` +
        `width="${sheetWidthMm - edgeMarginMm * 2}" height="${sheetHeightMm - edgeMarginMm * 2}" ` +
        `fill="none" stroke="${COLOURS.margin}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeWidth * 4} ${strokeWidth * 3}" />`
    );
  }

  for (const offcut of sheet.offcuts) {
    parts.push(
      `<rect x="${offcut.x}" y="${offsetY + offcut.y}" width="${offcut.widthMm}" height="${offcut.heightMm}" ` +
        `fill="${COLOURS.offcut}" stroke="${COLOURS.offcutEdge}" stroke-width="${strokeWidth * 0.5}" stroke-dasharray="${strokeWidth * 3} ${strokeWidth * 2}" />`
    );
  }

  for (const piece of sheet.pieces) {
    parts.push(
      `<rect x="${piece.x}" y="${offsetY + piece.y}" width="${piece.widthMm}" height="${piece.heightMm}" ` +
        `fill="${COLOURS.piece}" stroke="${COLOURS.pieceEdge}" stroke-width="${strokeWidth}" />`
    );

    const centreX = piece.x + piece.widthMm / 2;
    const centreY = offsetY + piece.y + piece.heightMm / 2;
    const caption = `${piece.widthMm} × ${piece.heightMm}${piece.rotated ? ' ↻' : ''}`;

    if (piece.label) {
      parts.push(
        `<text x="${centreX}" y="${centreY - fontSize * 0.15}" font-size="${fontSize}" text-anchor="middle" ` +
          `dominant-baseline="middle" fill="${COLOURS.text}">${escapeXml(piece.label)}</text>`
      );
      parts.push(
        `<text x="${centreX}" y="${centreY + fontSize}" font-size="${fontSize * 0.8}" text-anchor="middle" ` +
          `dominant-baseline="middle" fill="${COLOURS.mutedText}">${caption}</text>`
      );
    } else {
      parts.push(
        `<text x="${centreX}" y="${centreY}" font-size="${fontSize * 0.9}" text-anchor="middle" ` +
          `dominant-baseline="middle" fill="${COLOURS.text}">${caption}</text>`
      );
    }
  }

  return parts.join('\n');
}

/** Renders every sheet stacked vertically, one diagram for the whole plan. */
export function renderCuttingPlan(result: CuttingResult): string {
  if (result.sheets.length === 0) return '';

  const { sheetWidthMm, sheetHeightMm } = result.settings;
  const fontSize = Math.max(sheetWidthMm, sheetHeightMm) * 0.028;
  const strokeWidth = Math.max(sheetWidthMm, sheetHeightMm) * 0.0018;
  const gap = sheetHeightMm * 0.18;
  const topLabel = fontSize * 2;

  const body = result.sheets
    .map((sheet, index) =>
      renderSheet(sheet, result, topLabel + index * (sheetHeightMm + gap), fontSize, strokeWidth)
    )
    .join('\n');

  const totalHeight =
    topLabel + result.sheets.length * sheetHeightMm + (result.sheets.length - 1) * gap + fontSize;
  const pad = sheetWidthMm * 0.03;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${-pad} ${-pad} ${sheetWidthMm + pad * 2} ${totalHeight + pad * 2}" ` +
    `role="img" aria-label="Cutting plan" preserveAspectRatio="xMidYMid meet">\n` +
    `<rect x="${-pad}" y="${-pad}" width="${sheetWidthMm + pad * 2}" height="${totalHeight + pad * 2}" fill="#ffffff" />\n` +
    `${body}\n</svg>`
  );
}
