import type { ProjectSpecData } from './schema';

/**
 * Deterministic completeness check. The agent asks the user about whatever this
 * reports as missing; it never decides on its own that a spec is "complete
 * enough". Approval is blocked while anything required is absent, so the model
 * cannot talk its way past a gap (PRD §5.3, §5.4).
 *
 * The required set is the minimum needed for the downstream phases to do real
 * work: material calculation needs dimensions and materials, cutting needs
 * dimensions, costing needs quantity, and production needs mounting and site.
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

export const REQUIRED_FIELDS: readonly SpecFieldKey[] = [
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

export function missingFields(spec: ProjectSpecData): SpecFieldKey[] {
  const missing: SpecFieldKey[] = [];

  if (!isPresent(spec.projectType)) missing.push('projectType');
  if (!isPresent(spec.dimensions?.width)) missing.push('dimensions.width');
  if (!isPresent(spec.dimensions?.height)) missing.push('dimensions.height');
  if (!isPresent(spec.dimensions?.unit)) missing.push('dimensions.unit');
  if (!isPresent(spec.quantity)) missing.push('quantity');
  if (!isPresent(spec.materials)) missing.push('materials');
  if (!isPresent(spec.lighting?.type)) missing.push('lighting.type');
  if (!isPresent(spec.mounting?.method)) missing.push('mounting.method');
  if (!isPresent(spec.site?.environment)) missing.push('site.environment');

  return missing;
}

export function isSpecComplete(spec: ProjectSpecData): boolean {
  return missingFields(spec).length === 0;
}
