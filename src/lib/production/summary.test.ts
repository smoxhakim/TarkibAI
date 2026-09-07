import { describe, expect, it } from 'vitest';
import { SPEC_VERSION, type ProjectSpecData } from '@/lib/spec/schema';
import {
  buildComponents,
  buildMounting,
  buildSummary,
  formatDimensions,
  formatLettering,
  formatLighting,
} from './summary';

const spec = (patch: Partial<ProjectSpecData> = {}): ProjectSpecData => ({
  specVersion: SPEC_VERSION,
  ...patch,
});

describe('formatDimensions', () => {
  it('joins the stated dimensions with their unit', () => {
    expect(formatDimensions(spec({ dimensions: { width: 8, height: 3, unit: 'm' } }))).toBe('8 × 3 m');
  });

  it('includes depth when it was recorded', () => {
    expect(
      formatDimensions(spec({ dimensions: { width: 8, height: 3, depth: 0.2, unit: 'm' } }))
    ).toBe('8 × 3 × 0.2 m');
  });

  it('says the unit is missing rather than assuming one', () => {
    // A sign built to the wrong unit is scrap. Defaulting to metres here would
    // be a guess printed on a workshop sheet as fact.
    expect(formatDimensions(spec({ dimensions: { width: 800, height: 300 } }))).toBe(
      '800 × 300 (unit not recorded)'
    );
  });

  it('returns null when nothing was recorded', () => {
    expect(formatDimensions(spec())).toBeNull();
    expect(formatDimensions(spec({ dimensions: { unit: 'm' } }))).toBeNull();
  });
});

describe('formatLighting and formatLettering', () => {
  it('combines type and details', () => {
    expect(formatLighting(spec({ lighting: { type: 'led', details: 'halo-lit' } }))).toBe(
      'led — halo-lit'
    );
  });

  it('keeps "none" rather than treating it as absent', () => {
    // "No lighting" is a decision the workshop needs; it is not missing data.
    expect(formatLighting(spec({ lighting: { type: 'none' } }))).toBe('none');
  });

  it('returns null when the spec says nothing', () => {
    expect(formatLighting(spec())).toBeNull();
    expect(formatLighting(spec({ lighting: {} }))).toBeNull();
  });

  it('quotes the lettering and lists its colours', () => {
    expect(
      formatLettering(spec({ lettering: { text: 'CAFE MILANO', style: 'bold', colors: ['red', 'white'] } }))
    ).toBe('"CAFE MILANO" — bold — red, white');
  });
});

describe('buildSummary', () => {
  it('carries only what the spec recorded', () => {
    const result = buildSummary(
      spec({ projectType: 'enseigne', quantity: 2, finishNotes: 'brushed' })
    );

    expect(result).toEqual({
      projectType: 'enseigne',
      dimensions: null,
      quantity: 2,
      environment: null,
      lighting: null,
      lettering: null,
      finishNotes: 'brushed',
    });
  });

  it('invents nothing for an empty spec', () => {
    expect(Object.values(buildSummary(spec()))).toEqual([null, null, null, null, null, null, null]);
  });
});

describe('buildComponents', () => {
  it('carries each component through with its stated quantity', () => {
    expect(
      buildComponents(spec({ components: [{ name: 'Tray', quantity: 1 }, { name: 'Letters' }] }))
    ).toEqual([
      { name: 'Tray', quantity: 1, notes: null },
      { name: 'Letters', quantity: null, notes: null },
    ]);
  });

  it('is empty rather than invented when the spec lists none', () => {
    expect(buildComponents(spec())).toEqual([]);
  });
});

describe('buildMounting', () => {
  it('reports the method, surface and height that were recorded', () => {
    expect(
      buildMounting(spec({ mounting: { method: 'steel frame', surface: 'brick', heightFromGroundM: 3.5 } }))
    ).toEqual({ method: 'steel frame', surface: 'brick', heightFromGround: '3.5 m from ground' });
  });

  it('reports a partial record rather than filling the gaps', () => {
    expect(buildMounting(spec({ mounting: { method: 'chemical anchors' } }))).toEqual({
      method: 'chemical anchors',
      surface: null,
      heightFromGround: null,
    });
  });

  it('returns null when the spec says nothing about mounting', () => {
    expect(buildMounting(spec())).toBeNull();
    expect(buildMounting(spec({ mounting: {} }))).toBeNull();
    expect(buildMounting(spec({ mounting: { method: '   ' } }))).toBeNull();
  });
});
