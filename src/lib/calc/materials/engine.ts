/**
 * Deterministic material calculation. No AI, no I/O, no randomness — the same
 * inputs always produce the same outputs, which is what makes the results
 * testable and defensible to a client (PRD §5.3, ARCHITECTURE §10).
 *
 * # Why integer arithmetic
 *
 * Purchase counts come from a division followed by a ceiling. In binary
 * floating point, a quantity that should divide exactly can land a hair above
 * or below the boundary, and `Math.ceil` then buys one bar too many or too few.
 * So every count is computed in integers: millimetres for length, square
 * millimetres for area, whole units for pieces. Decimals appear only when
 * formatting a result for display.
 */

export type MeasurementModel = 'linear' | 'sheet' | 'area' | 'piece';

export type CalculationInput = {
  measurementModel: MeasurementModel;
  /** Metres for linear, square metres for sheet/area, a count for piece. */
  requiredQuantity: number;
  standardLengthMm: number | null;
  sheetWidthMm: number | null;
  sheetHeightMm: number | null;
  /** Price of one purchase unit, in integer minor currency units. */
  unitPriceCents: number;
};

/** One step of the derivation, so the user can audit how a number was reached. */
export type CalculationStep = {
  label: string;
  value: string;
};

export type CalculationWarning = {
  code: 'sheet_nesting_estimate' | 'linear_packing_estimate';
  message: string;
};

export type CalculationSuccess = {
  supported: true;
  /** Unit the quantities below are expressed in. */
  unit: 'm' | 'm²' | 'pieces';
  requiredQuantity: number;
  /** Whole bars/sheets/pieces to buy. Null for area, which has no discrete unit. */
  unitsToPurchase: number | null;
  purchasedQuantity: number;
  wasteQuantity: number;
  /** Share of what is bought that is not used, 0–100, rounded to 2 decimals. */
  wastePercent: number;
  totalCostCents: number;
  steps: CalculationStep[];
  warnings: CalculationWarning[];
};

export type CalculationFailure = {
  supported: false;
  reason: string;
};

export type CalculationResult = CalculationSuccess | CalculationFailure;

/** Ceiling division on integers. Exact where `Math.ceil(a / b)` is not. */
export function ceilDiv(numerator: number, denominator: number): number {
  return Math.floor((numerator + denominator - 1) / denominator);
}

const MM_PER_M = 1000;
const MM2_PER_M2 = 1_000_000;

/** Rounds a metre value to whole millimetres — the finest unit a workshop cuts to. */
const metresToMm = (metres: number): number => Math.round(metres * MM_PER_M);
const squareMetresToMm2 = (m2: number): number => Math.round(m2 * MM2_PER_M2);

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Trims trailing zeros so a step reads "6 m", not "6.000 m". */
const num = (value: number): string => String(Number(value.toFixed(3)));

export function calculateMaterialLine(input: CalculationInput): CalculationResult {
  const { measurementModel, requiredQuantity, unitPriceCents } = input;

  if (!Number.isFinite(requiredQuantity) || requiredQuantity <= 0) {
    return { supported: false, reason: 'The required quantity must be greater than zero.' };
  }

  switch (measurementModel) {
    case 'linear': {
      if (!input.standardLengthMm || input.standardLengthMm <= 0) {
        return {
          supported: false,
          reason: 'This material has no standard stock length, so the number of bars cannot be derived.',
        };
      }

      const requiredMm = metresToMm(requiredQuantity);
      const stockMm = input.standardLengthMm;
      const units = ceilDiv(requiredMm, stockMm);
      const purchasedMm = units * stockMm;
      const wasteMm = purchasedMm - requiredMm;

      const stockM = stockMm / MM_PER_M;
      const purchased = purchasedMm / MM_PER_M;
      const waste = wasteMm / MM_PER_M;

      return {
        supported: true,
        unit: 'm',
        requiredQuantity: round3(requiredMm / MM_PER_M),
        unitsToPurchase: units,
        purchasedQuantity: round3(purchased),
        wasteQuantity: round3(waste),
        wastePercent: purchasedMm === 0 ? 0 : round2((wasteMm / purchasedMm) * 100),
        totalCostCents: units * unitPriceCents,
        steps: [
          { label: 'Required', value: `${num(requiredMm / MM_PER_M)} m` },
          { label: 'Standard bar', value: `${num(stockM)} m` },
          // Shown unrounded so the ceiling is visibly a decision, not a fudge.
          { label: 'Bars needed', value: `${num(requiredMm / stockMm)} → rounded up to ${units}` },
          { label: 'Purchased', value: `${num(purchased)} m` },
          { label: 'Waste', value: `${num(waste)} m` },
        ],
        warnings: [
          {
            code: 'linear_packing_estimate',
            // Dividing total length by bar length UNDER-counts whenever the cut
            // lengths do not pack neatly. Four 4 m pieces from 6 m bars is 16 m,
            // which suggests three bars, but only one 4 m piece fits per bar —
            // four are needed. Under-buying stops a job mid-fabrication, so this
            // number must not be presented as exact.
            message:
              'This is a MINIMUM bar count from total length. It assumes bars can be used end to end. Cut lengths that do not pack neatly need more bars — four 4 m pieces need four 6 m bars, not three. For the real count, add the cut lengths and generate a cutting plan.',
          },
        ],
      };
    }

    case 'sheet': {
      if (!input.sheetWidthMm || !input.sheetHeightMm) {
        return {
          supported: false,
          reason: 'This material has no stock sheet size, so the number of sheets cannot be derived.',
        };
      }

      const requiredMm2 = squareMetresToMm2(requiredQuantity);
      const sheetMm2 = input.sheetWidthMm * input.sheetHeightMm;
      const units = ceilDiv(requiredMm2, sheetMm2);
      const purchasedMm2 = units * sheetMm2;
      const wasteMm2 = purchasedMm2 - requiredMm2;

      const sheetM2 = sheetMm2 / MM2_PER_M2;

      return {
        supported: true,
        unit: 'm²',
        requiredQuantity: round3(requiredMm2 / MM2_PER_M2),
        unitsToPurchase: units,
        purchasedQuantity: round3(purchasedMm2 / MM2_PER_M2),
        wasteQuantity: round3(wasteMm2 / MM2_PER_M2),
        wastePercent: purchasedMm2 === 0 ? 0 : round2((wasteMm2 / purchasedMm2) * 100),
        totalCostCents: units * unitPriceCents,
        steps: [
          { label: 'Required area', value: `${num(requiredMm2 / MM2_PER_M2)} m²` },
          {
            label: 'Sheet size',
            value: `${num(input.sheetWidthMm / MM_PER_M)} × ${num(input.sheetHeightMm / MM_PER_M)} m = ${num(sheetM2)} m²`,
          },
          { label: 'Sheets needed', value: `${num(requiredMm2 / sheetMm2)} → rounded up to ${units}` },
          { label: 'Purchased area', value: `${num(purchasedMm2 / MM2_PER_M2)} m²` },
          { label: 'Unused area', value: `${num(wasteMm2 / MM2_PER_M2)} m²` },
        ],
        warnings: [
          {
            code: 'sheet_nesting_estimate',
            // This is the honest caveat: area division assumes the pieces tile
            // the sheet perfectly, which real cutting never does.
            message:
              'This is a MINIMUM sheet count based on total area. It assumes pieces nest perfectly with no offcuts. For the real number of sheets, add the pieces to cut and generate a cutting plan.',
          },
        ],
      };
    }

    case 'area': {
      // Sold by the square metre with no discrete stock unit, so there is
      // nothing to round up to and no waste to attribute.
      const requiredMm2 = squareMetresToMm2(requiredQuantity);
      const requiredM2 = requiredMm2 / MM2_PER_M2;

      return {
        supported: true,
        unit: 'm²',
        requiredQuantity: round3(requiredM2),
        unitsToPurchase: null,
        purchasedQuantity: round3(requiredM2),
        wasteQuantity: 0,
        wastePercent: 0,
        totalCostCents: Math.round(requiredM2 * unitPriceCents),
        steps: [
          { label: 'Required area', value: `${num(requiredM2)} m²` },
          { label: 'Sold by', value: 'the square metre — no whole units to round up to' },
          { label: 'Purchased area', value: `${num(requiredM2)} m²` },
        ],
        warnings: [],
      };
    }

    case 'piece': {
      const units = Math.ceil(requiredQuantity);
      const waste = units - requiredQuantity;

      return {
        supported: true,
        unit: 'pieces',
        requiredQuantity: round3(requiredQuantity),
        unitsToPurchase: units,
        purchasedQuantity: units,
        wasteQuantity: round3(waste),
        wastePercent: units === 0 ? 0 : round2((waste / units) * 100),
        totalCostCents: units * unitPriceCents,
        steps: [
          { label: 'Required', value: `${num(requiredQuantity)} pieces` },
          { label: 'Purchased', value: `${units} pieces` },
        ],
        warnings: [],
      };
    }

    default:
      return {
        supported: false,
        reason: `Unknown measurement model: ${String(measurementModel)}`,
      };
  }
}
