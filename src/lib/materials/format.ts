import type { MeasurementModel } from './schema';

/**
 * Display helpers. Deliberately pure and separate from the service layer so
 * they can be unit-tested and reused by the UI, the AI layer, and later by
 * document templates without dragging in the database.
 */
export type MaterialDimensions = {
  measurementModel: string;
  standardLengthMm: number | null;
  sheetWidthMm: number | null;
  sheetHeightMm: number | null;
  thicknessMm: number | null;
};

/** Millimetres to a compact human string: 6000 -> "6 m", 2440 -> "2.44 m", 800 -> "800 mm". */
export function formatMillimetres(mm: number): string {
  if (mm >= 1000) {
    const metres = mm / 1000;
    // Trim trailing zeros so 6000 reads "6 m" rather than "6.00 m".
    return `${Number(metres.toFixed(3))} m`;
  }
  return `${mm} mm`;
}

/** The stock size a material is bought in, or null when its model has none. */
export function formatStockSize(material: MaterialDimensions): string | null {
  switch (material.measurementModel as MeasurementModel) {
    case 'linear':
      return material.standardLengthMm ? formatMillimetres(material.standardLengthMm) : null;
    case 'sheet':
      return material.sheetWidthMm && material.sheetHeightMm
        ? `${formatMillimetres(material.sheetWidthMm)} × ${formatMillimetres(material.sheetHeightMm)}`
        : null;
    case 'area':
    case 'piece':
    default:
      return null;
  }
}

export function formatThickness(thicknessMm: number | null): string | null {
  if (thicknessMm === null) return null;
  return `${Number(thicknessMm.toFixed(2))} mm`;
}

/**
 * Minor currency units to a display string.
 *
 * Money is stored as integer cents throughout (ARCHITECTURE §10); this is the
 * only place it becomes a decimal, and only for display.
 */
export function formatMoney(cents: number, currency = 'MAD'): string {
  const major = (cents / 100).toFixed(2);
  return `${major} ${currency}`;
}

/** Usable sheet area in m², used later by area-based costing. */
export function sheetAreaSquareMetres(widthMm: number, heightMm: number): number {
  return (widthMm / 1000) * (heightMm / 1000);
}
