import { describe, expect, it } from 'vitest';
import { mergeSpec } from './merge';
import { SPEC_VERSION, emptySpec, type ProjectSpecData } from './schema';

describe('mergeSpec', () => {
  it('adds new values to an empty spec', () => {
    const out = mergeSpec(emptySpec(), { projectType: 'enseigne', quantity: 2 });
    expect(out.projectType).toBe('enseigne');
    expect(out.quantity).toBe(2);
    expect(out.specVersion).toBe(SPEC_VERSION);
  });

  it('leaves untouched fields alone — a small patch must not erase earlier facts', () => {
    const current: ProjectSpecData = {
      specVersion: SPEC_VERSION,
      projectType: 'enseigne',
      quantity: 3,
      notes: 'client wants it fast',
    };
    const out = mergeSpec(current, { quantity: 5 });
    expect(out.quantity).toBe(5);
    expect(out.projectType).toBe('enseigne');
    expect(out.notes).toBe('client wants it fast');
  });

  it('merges nested objects key by key rather than replacing them', () => {
    const current: ProjectSpecData = {
      specVersion: SPEC_VERSION,
      dimensions: { width: 8, unit: 'm' },
    };
    const out = mergeSpec(current, { dimensions: { height: 3 } });
    // Setting a height must not lose the width the user already gave.
    expect(out.dimensions).toEqual({ width: 8, height: 3, unit: 'm' });
  });

  it('clears a single nested key with null without touching its siblings', () => {
    const current: ProjectSpecData = {
      specVersion: SPEC_VERSION,
      dimensions: { width: 8, height: 3, unit: 'm' },
    };
    const out = mergeSpec(current, { dimensions: { height: null } });
    expect(out.dimensions).toEqual({ width: 8, unit: 'm' });
  });

  it('clears a whole field with a top-level null', () => {
    const current: ProjectSpecData = { specVersion: SPEC_VERSION, projectType: 'totem', quantity: 1 };
    const out = mergeSpec(current, { projectType: null });
    expect(out.projectType).toBeUndefined();
    expect(out.quantity).toBe(1);
  });

  it('drops a nested object entirely once its last key is cleared', () => {
    const current: ProjectSpecData = { specVersion: SPEC_VERSION, lighting: { type: 'led' } };
    const out = mergeSpec(current, { lighting: { type: null } });
    expect(out.lighting).toBeUndefined();
  });

  it('replaces arrays wholesale instead of appending', () => {
    const current: ProjectSpecData = {
      specVersion: SPEC_VERSION,
      materials: [{ name: 'alucobond' }, { name: 'inox' }],
    };
    const out = mergeSpec(current, { materials: [{ name: 'plexi' }] });
    // Concatenating would make removal impossible and duplicate entries every
    // time the agent restated the list.
    expect(out.materials).toEqual([{ name: 'plexi' }]);
  });

  it('ignores undefined values so an absent key never clears anything', () => {
    const current: ProjectSpecData = { specVersion: SPEC_VERSION, projectType: 'façade' };
    const out = mergeSpec(current, { projectType: undefined });
    expect(out.projectType).toBe('façade');
  });

  it('does not mutate the input spec', () => {
    const current: ProjectSpecData = { specVersion: SPEC_VERSION, dimensions: { width: 8 } };
    mergeSpec(current, { dimensions: { width: 10 } });
    expect(current.dimensions?.width).toBe(8);
  });

  it('always stamps the current spec version', () => {
    const out = mergeSpec({ specVersion: SPEC_VERSION }, {});
    expect(out.specVersion).toBe(SPEC_VERSION);
  });
});
