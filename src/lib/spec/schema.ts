import { z } from 'zod';

/**
 * The structured project specification — the canonical representation of a
 * project (PRD §9). Chat messages are NOT the source of truth; this is.
 *
 * Every field is optional. The specification is built up across a conversation,
 * and a partially-known project is a normal, valid state. Whether enough is
 * known to proceed is a separate deterministic question, answered by
 * `missingFields()` in ./completeness — never by the model.
 *
 * `specVersion` is stored with the data so that older specs remain readable
 * when the shape evolves in later phases.
 */
export const SPEC_VERSION = 1;

export const lengthUnitSchema = z.enum(['mm', 'cm', 'm']);
export type LengthUnit = z.infer<typeof lengthUnitSchema>;

export const dimensionsSchema = z.object({
  width: z.number().positive().nullable().optional(),
  height: z.number().positive().nullable().optional(),
  depth: z.number().positive().nullable().optional(),
  unit: lengthUnitSchema.nullable().optional(),
});

export const materialRequestSchema = z.object({
  // Free text at this phase. The user's own Material library arrives in Phase 3,
  // and linking a requested material to a Material row happens there.
  name: z.string().trim().min(1).max(120),
  appliesTo: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const componentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const lightingSchema = z.object({
  type: z.enum(['none', 'led', 'neon', 'backlit', 'frontlit', 'halo', 'other']).nullable().optional(),
  details: z.string().trim().max(500).nullable().optional(),
});

export const mountingSchema = z.object({
  method: z.string().trim().max(200).nullable().optional(),
  surface: z.string().trim().max(200).nullable().optional(),
  heightFromGroundM: z.number().nonnegative().nullable().optional(),
});

export const siteSchema = z.object({
  environment: z.enum(['indoor', 'outdoor']).nullable().optional(),
  locationText: z.string().trim().max(300).nullable().optional(),
});

export const letteringSchema = z.object({
  text: z.string().trim().max(300).nullable().optional(),
  style: z.string().trim().max(200).nullable().optional(),
  colors: z.array(z.string().trim().min(1).max(60)).max(12).nullable().optional(),
});

export const projectSpecSchema = z.object({
  specVersion: z.literal(SPEC_VERSION).default(SPEC_VERSION),

  /** e.g. enseigne, façade, totem, caisson lumineux, lettres 3D, panneau. */
  projectType: z.string().trim().max(120).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),

  dimensions: dimensionsSchema.nullable().optional(),
  quantity: z.number().int().positive().nullable().optional(),

  components: z.array(componentSchema).max(50).nullable().optional(),
  materials: z.array(materialRequestSchema).max(50).nullable().optional(),

  lighting: lightingSchema.nullable().optional(),
  mounting: mountingSchema.nullable().optional(),
  site: siteSchema.nullable().optional(),
  lettering: letteringSchema.nullable().optional(),

  finishNotes: z.string().trim().max(1000).nullable().optional(),
  deadline: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type ProjectSpecData = z.infer<typeof projectSpecSchema>;

/** The patch shape the AI is allowed to submit. Identical fields, all optional. */
export const projectSpecPatchSchema = projectSpecSchema.partial().omit({ specVersion: true });
export type ProjectSpecPatch = z.infer<typeof projectSpecPatchSchema>;

export const emptySpec = (): ProjectSpecData => ({ specVersion: SPEC_VERSION });

/** Parses persisted JSON back into a spec, tolerating rows written by older code. */
export function parseSpecData(value: unknown): ProjectSpecData {
  const result = projectSpecSchema.safeParse(value);
  return result.success ? result.data : emptySpec();
}
