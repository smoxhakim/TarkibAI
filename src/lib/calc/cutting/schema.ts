import { z } from 'zod';

const mm = z.number().int('Dimensions are whole millimetres.').positive().max(20_000);

export const cuttingPieceSchema = z.object({
  materialId: z.string().uuid(),
  label: z.string().trim().max(160).nullable().optional(),
  widthMm: mm,
  heightMm: mm,
  quantity: z.number().int().positive().max(1000),
  /** False for materials with a grain or print direction. */
  allowRotation: z.boolean().default(true),
});

export type CuttingPieceInputPayload = z.infer<typeof cuttingPieceSchema>;

export const cuttingPieceUpdateSchema = cuttingPieceSchema.omit({ materialId: true }).partial();

/**
 * Per-plan overrides. Defaults come from the material's technicalProperties,
 * which is what that extensible field was added for in T3.
 */
export const linearCutSchema = z.object({
  materialId: z.string().uuid(),
  label: z.string().trim().max(160).nullable().optional(),
  lengthMm: mm,
  quantity: z.number().int().positive().max(1000),
});

export type LinearCutInputPayload = z.infer<typeof linearCutSchema>;

export const calculateLinearSchema = z.object({
  materialId: z.string().uuid(),
  kerfMm: z.number().int().min(0).max(50).optional(),
  minUsableRemnantMm: z.number().int().min(0).max(10_000).optional(),
});

export const calculateCuttingSchema = z.object({
  materialId: z.string().uuid(),
  kerfMm: z.number().int().min(0).max(50).optional(),
  edgeMarginMm: z.number().int().min(0).max(200).optional(),
});

/** Reads kerf/margin from a material's technicalProperties, tolerating anything. */
export function readCutDefaults(technicalProperties: unknown): {
  kerfMm: number;
  edgeMarginMm: number;
} {
  const fallback = { kerfMm: 0, edgeMarginMm: 0 };
  if (typeof technicalProperties !== 'object' || technicalProperties === null) return fallback;

  const record = technicalProperties as Record<string, unknown>;
  const asInt = (value: unknown, max: number): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const rounded = Math.round(value);
    return rounded >= 0 && rounded <= max ? rounded : null;
  };

  return {
    kerfMm: asInt(record.kerfMm, 50) ?? fallback.kerfMm,
    edgeMarginMm: asInt(record.edgeMarginMm, 200) ?? fallback.edgeMarginMm,
  };
}

/**
 * Shortest bar tail still worth keeping, from the material's technical
 * properties. Defaults to 0, which treats every tail as reusable — the
 * conservative choice for waste, since claiming material is scrap when it is
 * not would overstate the cost of a job.
 */
export function readMinUsableRemnant(technicalProperties: unknown): number {
  if (typeof technicalProperties !== 'object' || technicalProperties === null) return 0;
  const value = (technicalProperties as Record<string, unknown>).minUsableRemnantMm;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return rounded >= 0 && rounded <= 10_000 ? rounded : 0;
}
