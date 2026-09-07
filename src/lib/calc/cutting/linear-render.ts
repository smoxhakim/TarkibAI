import type { LinearResult } from './linear';

/**
 * Renders a linear cut plan to SVG — one horizontal strip per bar, showing the
 * cut sequence in order along the bar.
 *
 * Pure and deterministic, like the sheet diagram, because this goes into the
 * production document a workshop cuts from.
 *
 * Bars are drawn to scale along their length but at a fixed visual height:
 * a 6 m bar of 40 mm tube drawn to true proportion would be a hairline.
 */
const COLOURS = {
  bar: '#f3f4f6',
  barEdge: '#1f2937',
  cut: '#dbeafe',
  cutEdge: '#1d4ed8',
  remnantUsable: '#dcfce7',
  remnantScrap: '#fee2e2',
  remnantEdge: '#9ca3af',
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

const formatMm = (mm: number): string =>
  Math.abs(mm) >= 1000 ? `${Number((mm / 1000).toFixed(3))} m` : `${mm} mm`;

export function renderLinearPlan(result: LinearResult): string {
  if (result.bars.length === 0) return '';

  const { stockLengthMm, kerfMm } = result.settings;

  // Proportions are expressed relative to bar length so the diagram scales to
  // any stock size without hard-coded pixel values.
  const barHeight = stockLengthMm * 0.06;
  const rowGap = barHeight * 1.9;
  const fontSize = barHeight * 0.42;
  const strokeWidth = stockLengthMm * 0.0009;
  const labelWidth = stockLengthMm * 0.11;

  const rows = result.bars.map((bar, index) => {
    const y = index * rowGap;
    const parts: string[] = [];

    parts.push(
      `<text x="${-labelWidth * 0.2}" y="${y + barHeight * 0.62}" font-size="${fontSize}" ` +
        `text-anchor="end" fill="${COLOURS.text}" font-weight="600">Bar ${bar.index + 1}</text>`
    );

    parts.push(
      `<rect x="0" y="${y}" width="${stockLengthMm}" height="${barHeight}" ` +
        `fill="${COLOURS.bar}" stroke="${COLOURS.barEdge}" stroke-width="${strokeWidth}" />`
    );

    for (const cutPiece of bar.cuts) {
      parts.push(
        `<rect x="${cutPiece.offsetMm}" y="${y}" width="${cutPiece.lengthMm}" height="${barHeight}" ` +
          `fill="${COLOURS.cut}" stroke="${COLOURS.cutEdge}" stroke-width="${strokeWidth}" />`
      );

      const centre = cutPiece.offsetMm + cutPiece.lengthMm / 2;

      // A short cut is a narrow box. Text wider than its segment spills over the
      // neighbouring one and the two become unreadable, so the caption degrades:
      // full label, then length alone, then nothing. Estimated from character
      // count because real text metrics are not available server-side, and only
      // a rough comparison is needed.
      const captionFontSize = fontSize * 0.85;
      const estimateWidth = (text: string) => text.length * captionFontSize * 0.55;
      const full = cutPiece.label ? `${cutPiece.label} · ${cutPiece.lengthMm}` : String(cutPiece.lengthMm);
      const short = String(cutPiece.lengthMm);
      const available = cutPiece.lengthMm * 0.92;

      const caption =
        estimateWidth(full) <= available ? full : estimateWidth(short) <= available ? short : null;

      if (caption) {
        parts.push(
          `<text x="${centre}" y="${y + barHeight * 0.62}" font-size="${captionFontSize}" ` +
            `text-anchor="middle" fill="${COLOURS.text}">${escapeXml(caption)}</text>`
        );
      }
    }

    if (bar.remnantMm > 0) {
      const remnantX = stockLengthMm - bar.remnantMm;
      parts.push(
        `<rect x="${remnantX}" y="${y}" width="${bar.remnantMm}" height="${barHeight}" ` +
          `fill="${bar.remnantUsable ? COLOURS.remnantUsable : COLOURS.remnantScrap}" ` +
          `stroke="${COLOURS.remnantEdge}" stroke-width="${strokeWidth * 0.6}" ` +
          `stroke-dasharray="${strokeWidth * 4} ${strokeWidth * 3}" />`
      );
    }

    parts.push(
      `<text x="${stockLengthMm}" y="${y + barHeight * 1.45}" font-size="${fontSize * 0.8}" ` +
        `text-anchor="end" fill="${COLOURS.mutedText}">` +
        `${bar.utilisationPercent}% used · remnant ${formatMm(bar.remnantMm)}` +
        `${bar.remnantMm > 0 ? (bar.remnantUsable ? ' (keep)' : ' (scrap)') : ''}` +
        `${bar.kerfMm > 0 ? ` · kerf ${bar.kerfMm} mm` : ''}</text>`
    );

    return parts.join('\n');
  });

  const totalHeight = result.bars.length * rowGap;
  const padX = stockLengthMm * 0.02;
  const header = fontSize * 1.8;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${-labelWidth - padX} ${-header} ${stockLengthMm + labelWidth + padX * 2} ${totalHeight + header}" ` +
    `role="img" aria-label="Linear cutting plan" preserveAspectRatio="xMidYMid meet">\n` +
    `<rect x="${-labelWidth - padX}" y="${-header}" width="${stockLengthMm + labelWidth + padX * 2}" ` +
    `height="${totalHeight + header}" fill="#ffffff" />\n` +
    `<text x="0" y="${-header * 0.35}" font-size="${fontSize}" fill="${COLOURS.text}" font-weight="600">` +
    `${result.barsUsed} bar${result.barsUsed === 1 ? '' : 's'} of ${formatMm(stockLengthMm)}` +
    `${kerfMm > 0 ? ` · ${kerfMm} mm kerf` : ''}</text>\n` +
    `${rows.join('\n')}\n</svg>`
  );
}
