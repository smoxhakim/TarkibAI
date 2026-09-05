import { describe, expect, it } from 'vitest';
import { REQUIRED_FIELDS, isSpecComplete, missingFields } from './completeness';
import { SPEC_VERSION, emptySpec, type ProjectSpecData } from './schema';

const completeSpec: ProjectSpecData = {
  specVersion: SPEC_VERSION,
  projectType: 'enseigne',
  dimensions: { width: 8, height: 3, unit: 'm' },
  quantity: 1,
  materials: [{ name: 'alucobond noir' }],
  lighting: { type: 'led' },
  mounting: { method: 'wall-mounted on steel frame' },
  site: { environment: 'outdoor' },
};

describe('missingFields', () => {
  it('reports every required field for an empty spec', () => {
    expect(missingFields(emptySpec()).sort()).toEqual([...REQUIRED_FIELDS].sort());
  });

  it('reports nothing for a complete spec', () => {
    expect(missingFields(completeSpec)).toEqual([]);
    expect(isSpecComplete(completeSpec)).toBe(true);
  });

  it('treats a dimension without a unit as incomplete', () => {
    const spec = { ...completeSpec, dimensions: { width: 8, height: 3 } };
    // A number with no unit is not a usable measurement for fabrication.
    expect(missingFields(spec)).toContain('dimensions.unit');
  });

  it('treats an empty materials array as missing, not as an answer', () => {
    expect(missingFields({ ...completeSpec, materials: [] })).toContain('materials');
  });

  it('treats a whitespace-only string as missing', () => {
    expect(missingFields({ ...completeSpec, projectType: '   ' })).toContain('projectType');
  });

  it('accepts lighting explicitly set to none as answered', () => {
    const spec = { ...completeSpec, lighting: { type: 'none' as const } };
    // "No lighting" is a real decision, distinct from never having been asked.
    expect(missingFields(spec)).not.toContain('lighting.type');
  });

  it('treats zero quantity as absent rather than valid', () => {
    const spec = { ...completeSpec, quantity: undefined };
    expect(missingFields(spec)).toContain('quantity');
  });

  it('reports only what is actually missing on a partial spec', () => {
    const spec: ProjectSpecData = {
      specVersion: SPEC_VERSION,
      projectType: 'totem',
      dimensions: { width: 1, height: 4, unit: 'm' },
    };
    const missing = missingFields(spec);
    expect(missing).not.toContain('projectType');
    expect(missing).not.toContain('dimensions.width');
    expect(missing).toContain('materials');
    expect(missing).toContain('site.environment');
  });
});
