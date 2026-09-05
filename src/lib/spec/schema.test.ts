import { describe, expect, it } from 'vitest';
import { parseSpecData, projectSpecPatchSchema, projectSpecSchema, SPEC_VERSION } from './schema';

describe('projectSpecPatchSchema', () => {
  it('accepts a realistic patch from a Darija conversation', () => {
    const result = projectSpecPatchSchema.safeParse({
      projectType: 'enseigne',
      dimensions: { width: 8, unit: 'm' },
      materials: [{ name: 'alucobond noir', appliesTo: 'façade' }],
      lighting: { type: 'led' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts null to clear a field the user retracted', () => {
    expect(projectSpecPatchSchema.safeParse({ projectType: null }).success).toBe(true);
    expect(projectSpecPatchSchema.safeParse({ dimensions: { height: null } }).success).toBe(true);
  });

  it('rejects a negative or zero dimension', () => {
    expect(projectSpecPatchSchema.safeParse({ dimensions: { width: -2 } }).success).toBe(false);
    expect(projectSpecPatchSchema.safeParse({ dimensions: { width: 0 } }).success).toBe(false);
  });

  it('rejects an unknown unit, so an unlabelled number cannot slip through', () => {
    expect(projectSpecPatchSchema.safeParse({ dimensions: { unit: 'feet' } }).success).toBe(false);
  });

  it('rejects a non-integer quantity', () => {
    expect(projectSpecPatchSchema.safeParse({ quantity: 2.5 }).success).toBe(false);
  });

  it('rejects an unknown lighting type', () => {
    expect(projectSpecPatchSchema.safeParse({ lighting: { type: 'plasma' } }).success).toBe(false);
  });

  it('rejects a material entry with no name', () => {
    expect(projectSpecPatchSchema.safeParse({ materials: [{ appliesTo: 'façade' }] }).success).toBe(false);
  });

  it('accepts Arabic-script content', () => {
    const result = projectSpecPatchSchema.safeParse({
      projectType: 'لافتة',
      lettering: { text: 'مطعم الأصالة' },
    });
    expect(result.success).toBe(true);
  });
});

describe('parseSpecData', () => {
  it('round-trips a valid stored spec', () => {
    const stored = { specVersion: SPEC_VERSION, projectType: 'totem', quantity: 2 };
    expect(parseSpecData(stored).projectType).toBe('totem');
  });

  it('falls back to an empty spec for unreadable data rather than throwing', () => {
    // A malformed row must not take down the whole project workspace.
    expect(parseSpecData({ specVersion: 99, garbage: true })).toEqual({ specVersion: SPEC_VERSION });
    expect(parseSpecData(null)).toEqual({ specVersion: SPEC_VERSION });
    expect(parseSpecData('nonsense')).toEqual({ specVersion: SPEC_VERSION });
  });
});

describe('projectSpecSchema', () => {
  it('defaults specVersion when absent', () => {
    expect(projectSpecSchema.parse({}).specVersion).toBe(SPEC_VERSION);
  });
});
