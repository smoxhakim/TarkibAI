import { z } from 'zod';

/**
 * The structured scene behind the Smart Canvas (ARCHITECTURE §14).
 *
 * Objects carry real geometry in INTEGER MILLIMETRES, the same unit the
 * material and cutting engines work in. The canvas is therefore a
 * dimensionally meaningful representation, not a picture: an 8 m sign is
 * 8000 units wide, and that number is the same one a calculation would use.
 *
 * It is deliberately NOT an image. Image generation produces something that
 * looks like a sign; this produces something the system can measure, label and
 * later derive drawings from (PRD §10, ARCHITECTURE §13).
 */
export const SCENE_VERSION = 1;

/**
 * Object types kept to what signage and fabrication actually needs today.
 * Adding a type is cheap; inventing types nothing renders is not.
 */
export const OBJECT_TYPES = ['panel', 'frame', 'lettering', 'light', 'note'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  panel: 'Panel',
  frame: 'Frame',
  lettering: 'Lettering',
  light: 'Lighting',
  note: 'Note',
};

/** Millimetres. Bounds are sanity limits that catch a slipped decimal point. */
const mm = z.number().int('Geometry is whole millimetres.').min(-1_000_000).max(1_000_000);
const positiveMm = z
  .number()
  .int('Geometry is whole millimetres.')
  .positive('Dimensions must be greater than zero.')
  .max(1_000_000);

export const sceneObjectSchema = z.object({
  /** Stable identifier, used by AI commands to address an object. */
  id: z.string().min(1).max(64),
  type: z.enum(OBJECT_TYPES),

  /** Human label, e.g. "Main face" or "ATLAS". Shown on the canvas. */
  label: z.string().trim().max(160).nullable().optional(),

  /** Top-left origin, millimetres, relative to the scene origin. */
  x: mm,
  y: mm,
  widthMm: positiveMm,
  heightMm: positiveMm,

  /** Degrees clockwise. Whole degrees only — fabrication does not need finer. */
  rotationDeg: z.number().int().min(-360).max(360).default(0),

  /** Links the object to the user's material library. Not resolved here. */
  materialId: z.string().uuid().nullable().optional(),

  /** Free-text annotation shown alongside the object in the drawing. */
  notes: z.string().trim().max(500).nullable().optional(),

  /** Whether to draw a dimension annotation for this object. */
  showDimensions: z.boolean().default(true),
});

export type SceneObject = z.infer<typeof sceneObjectSchema>;

export const canvasSceneSchema = z.object({
  sceneVersion: z.literal(SCENE_VERSION).default(SCENE_VERSION),
  objects: z.array(sceneObjectSchema).max(200).default([]),
});

export type CanvasSceneData = z.infer<typeof canvasSceneSchema>;

export const emptyScene = (): CanvasSceneData => ({ sceneVersion: SCENE_VERSION, objects: [] });

/** Parses stored JSON, tolerating rows written by older code. */
export function parseScene(value: unknown): CanvasSceneData {
  const result = canvasSceneSchema.safeParse(value);
  return result.success ? result.data : emptyScene();
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The command vocabulary for mutating a scene.
 *
 * Every change — from the edit panel now, and from AI tools in T7 — goes
 * through these. A single validated command surface means the agent cannot
 * reach a mutation path the UI does not also use, and both inherit the same
 * validation (ARCHITECTURE §7).
 */
export const addObjectCommandSchema = z.object({
  kind: z.literal('add_object'),
  object: sceneObjectSchema.omit({ id: true }).extend({ id: z.string().min(1).max(64).optional() }),
});

export const updateObjectCommandSchema = z.object({
  kind: z.literal('update_object'),
  id: z.string().min(1).max(64),
  /** Only the named fields change; omitted fields keep their value. */
  changes: sceneObjectSchema.omit({ id: true }).partial(),
});

export const removeObjectCommandSchema = z.object({
  kind: z.literal('remove_object'),
  id: z.string().min(1).max(64),
});

export const sceneCommandSchema = z.discriminatedUnion('kind', [
  addObjectCommandSchema,
  updateObjectCommandSchema,
  removeObjectCommandSchema,
]);

export type SceneCommand = z.infer<typeof sceneCommandSchema>;
