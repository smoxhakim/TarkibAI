import type { ProjectSpecData } from './schema';

/**
 * Deterministic completeness check. The agent asks the user about whatever this
 * reports as missing; it never decides on its own that a spec is "complete
 * enough". Approval is blocked while anything required is absent, so the model
 * cannot talk its way past a gap (PRD §5.3, §5.4).
 *
 * WHICH fields are required is a domain decision (T17), not a platform one:
 * lighting is a real choice on a shopfront and meaningless on a set of kitchen
 * units. WHAT "required" means — a gap that blocks approval — is the same
 * everywhere, and stays here.
 *
 * The shape of the required set is still the minimum needed for the downstream
 * phases to do real work: material calculation needs dimensions and materials,
 * cutting needs dimensions, costing needs quantity, and production needs
 * mounting and site.
 */
export type SpecFieldKey =
  | 'projectType'
  | 'dimensions.width'
  | 'dimensions.height'
  | 'dimensions.unit'
  | 'quantity'
  | 'materials'
  | 'lighting.type'
  | 'mounting.method'
  | 'site.environment';

/** Every field any domain can require. Domains choose a subset. */
export const ALL_SPEC_FIELDS: readonly SpecFieldKey[] = [
  'projectType',
  'dimensions.width',
  'dimensions.height',
  'dimensions.unit',
  'quantity',
  'materials',
  'lighting.type',
  'mounting.method',
  'site.environment',
];

/** Short English labels, used in the spec panel and in prompts to the agent. */
export const FIELD_LABELS: Record<SpecFieldKey, string> = {
  projectType: 'Project type',
  'dimensions.width': 'Width',
  'dimensions.height': 'Height',
  'dimensions.unit': 'Dimension unit',
  quantity: 'Quantity',
  materials: 'Materials',
  'lighting.type': 'Lighting',
  'mounting.method': 'Mounting method',
  'site.environment': 'Indoor or outdoor',
};

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Where each field lives in the specification. One place, so a new field
 *  cannot be required by a domain without also being readable. */
const READERS: Record<SpecFieldKey, (spec: ProjectSpecData) => unknown> = {
  projectType: (spec) => spec.projectType,
  'dimensions.width': (spec) => spec.dimensions?.width,
  'dimensions.height': (spec) => spec.dimensions?.height,
  'dimensions.unit': (spec) => spec.dimensions?.unit,
  quantity: (spec) => spec.quantity,
  materials: (spec) => spec.materials,
  'lighting.type': (spec) => spec.lighting?.type,
  'mounting.method': (spec) => spec.mounting?.method,
  'site.environment': (spec) => spec.site?.environment,
};

/**
 * Which required fields are still unanswered, in the order the domain lists
 * them — so the agent asks about them in the order the trade cares about.
 */
export function missingFields(
  spec: ProjectSpecData,
  required: readonly SpecFieldKey[] = ALL_SPEC_FIELDS
): SpecFieldKey[] {
  return required.filter((field) => !isPresent(READERS[field](spec)));
}

export function isSpecComplete(
  spec: ProjectSpecData,
  required: readonly SpecFieldKey[] = ALL_SPEC_FIELDS
): boolean {
  return missingFields(spec, required).length === 0;
}
