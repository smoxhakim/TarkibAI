import { z } from 'zod';

/**
 * How a material is measured, stocked and priced. This drives which dimensions
 * are required and what `unitPriceCents` refers to (ARCHITECTURE §11).
 */
export const MEASUREMENT_MODELS = ['linear', 'sheet', 'area', 'piece'] as const;
export type MeasurementModel = (typeof MEASUREMENT_MODELS)[number];

export const MEASUREMENT_MODEL_LABELS: Record<MeasurementModel, string> = {
  linear: 'Linear (bars, tubes, profiles)',
  sheet: 'Sheet (panels sold as whole sheets)',
  area: 'Area (priced per m²)',
  piece: 'Piece (sold individually)',
};

/** What one unit of price buys, per measurement model. Shown next to the price field. */
export const PRICE_UNIT_LABELS: Record<MeasurementModel, string> = {
  linear: 'per bar',
  sheet: 'per sheet',
  area: 'per m²',
  piece: 'per piece',
};

/**
 * Starting categories for signage and fabrication. Users are not limited to
 * these — a custom category is stored with customCategory = true.
 */
export const MATERIAL_CATEGORIES = [
  'Metal',
  'Wood',
  'Panel',
  'Acrylic',
  'PVC',
  'Lighting',
  'Vinyl',
  'Hardware',
  'Paint & finish',
  'Other',
] as const;

// Bounds are sanity limits, not fabrication rules: 100 m of stock length and a
// 10 m sheet edge are far beyond real stock, while still catching a slipped
// decimal point or a value entered in the wrong unit.
const MAX_LENGTH_MM = 100_000;
const MAX_SHEET_EDGE_MM = 10_000;

const millimetres = (max: number) =>
  z
    .number()
    .int('Dimensions must be whole millimetres.')
    .positive('Dimensions must be greater than zero.')
    .max(max);

const baseMaterialSchema = z.object({
  name: z.string().trim().min(1, 'A material name is required.').max(160),
  category: z.string().trim().min(1, 'A category is required.').max(80),
  customCategory: z.boolean().default(false),
  supplier: z.string().trim().max(160).nullable().optional(),
  measurementModel: z.enum(MEASUREMENT_MODELS),

  standardLengthMm: millimetres(MAX_LENGTH_MM).nullable().optional(),
  sheetWidthMm: millimetres(MAX_SHEET_EDGE_MM).nullable().optional(),
  sheetHeightMm: millimetres(MAX_SHEET_EDGE_MM).nullable().optional(),

  thicknessMm: z
    .number()
    .positive('Thickness must be greater than zero.')
    .max(1000)
    .nullable()
    .optional(),

  unitPriceCents: z
    .number()
    .int('Prices are stored in minor currency units, so they must be whole numbers.')
    .nonnegative('A price cannot be negative.')
    .max(1_000_000_00),

  technicalProperties: z.record(z.string(), z.unknown()).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/**
 * A material is only useful to the calculation engine if it carries the
 * dimensions its measurement model needs. Enforcing that here means T4 can
 * trust the data instead of defending against half-filled records.
 */
function refineModelRules(
  value: z.infer<typeof baseMaterialSchema>,
  ctx: z.RefinementCtx
): void {
  if (value.measurementModel === 'linear' && !value.standardLengthMm) {
    ctx.addIssue({
      code: 'custom',
      path: ['standardLengthMm'],
      message: 'A linear material needs its standard stock length.',
    });
  }

  if (value.measurementModel === 'sheet') {
    if (!value.sheetWidthMm) {
      ctx.addIssue({
        code: 'custom',
        path: ['sheetWidthMm'],
        message: 'A sheet material needs its stock width.',
      });
    }
    if (!value.sheetHeightMm) {
      ctx.addIssue({
        code: 'custom',
        path: ['sheetHeightMm'],
        message: 'A sheet material needs its stock height.',
      });
    }
  }
}

export const createMaterialSchema = baseMaterialSchema.superRefine(refineModelRules);
export type CreateMaterialInput = z.infer<typeof baseMaterialSchema>;

/**
 * Updates are validated as a whole record, not a sparse patch: the model rules
 * above are cross-field, so a partial patch could otherwise leave a linear
 * material with no stock length.
 */
export const updateMaterialSchema = baseMaterialSchema.superRefine(refineModelRules);
export type UpdateMaterialInput = CreateMaterialInput;

export const materialQuerySchema = z.object({
  search: z.string().trim().max(160).optional(),
  category: z.string().trim().max(80).optional(),
  measurementModel: z.enum(MEASUREMENT_MODELS).optional(),
  includeArchived: z.boolean().default(false),
});
export type MaterialQuery = z.infer<typeof materialQuerySchema>;

export const selectProjectMaterialSchema = z.object({
  materialId: z.string().uuid(),
  role: z.string().trim().max(160).nullable().optional(),
});
