import { describe, expect, it } from 'vitest';
import { buildMockupPrompt, pixelDimensions } from './prompt';
import { SPEC_VERSION, type ProjectSpecData } from '@/lib/spec/schema';

const spec = (overrides: Partial<ProjectSpecData> = {}): ProjectSpecData => ({
  specVersion: SPEC_VERSION,
  ...overrides,
});

describe('pixelDimensions', () => {
  it('follows the real aspect ratio of a wide sign', () => {
    // An 8 x 3 m sign rendered square would show a sign nobody is buying.
    const { widthPx, heightPx } = pixelDimensions(8000, 3000);
    expect(widthPx).toBeGreaterThan(heightPx);
    expect(widthPx / heightPx).toBeCloseTo(8 / 3, 1);
  });

  it('follows the ratio of a tall sign', () => {
    const { widthPx, heightPx } = pixelDimensions(1000, 4000);
    expect(heightPx).toBeGreaterThan(widthPx);
  });

  it('falls back to square when dimensions are unknown', () => {
    expect(pixelDimensions(null, null)).toEqual({ widthPx: 1024, heightPx: 1024 });
    expect(pixelDimensions(0, 100)).toEqual({ widthPx: 1024, heightPx: 1024 });
  });

  it('returns dimensions a model will accept', () => {
    const { widthPx, heightPx } = pixelDimensions(8000, 3000);
    // Multiples of 16, and never degenerate.
    expect(widthPx % 16).toBe(0);
    expect(heightPx % 16).toBe(0);
    expect(heightPx).toBeGreaterThanOrEqual(128);
  });

  it('preserves the ratio across realistic signage proportions', () => {
    // The earlier minimum-edge floor silently squared these off, which is the
    // one thing the function must not do.
    for (const [w, h] of [
      [8000, 3000], // typical facade sign
      [6000, 1000], // fascia band
      [2400, 1200], // panel
      [1000, 3000], // totem
      [10000, 1200], // long shopfront band
    ]) {
      const { widthPx, heightPx } = pixelDimensions(w, h);
      expect(widthPx / heightPx).toBeCloseTo(w / h, 0);
    }
  });

  it('keeps the short edge usable on an extreme ratio, accepting some distortion', () => {
    // A 30:1 banner cannot be both true to proportion and inside a model's size
    // limits. The short edge stays usable and the distortion is accepted.
    const { widthPx, heightPx } = pixelDimensions(30000, 1000);
    expect(heightPx).toBeGreaterThanOrEqual(128);
    expect(widthPx).toBeLessThanOrEqual(1440);
    expect(widthPx).toBeGreaterThan(heightPx);
  });
});

describe('buildMockupPrompt', () => {
  it('uses only facts the specification records', () => {
    const result = buildMockupPrompt(
      spec({
        projectType: 'enseigne',
        materials: [{ name: 'alucobond noir' }],
        lighting: { type: 'led' },
      }),
      'concept'
    );

    expect(result.prompt).toContain('enseigne');
    expect(result.prompt).toContain('alucobond noir');
    expect(result.prompt).toContain('led');
    // Nothing invented: no colour, size or material the user never stated.
    expect(result.prompt).not.toMatch(/\b(steel|aluminium|red|blue)\b/i);
  });

  it('records the facts it used, for auditability', () => {
    const result = buildMockupPrompt(
      spec({ projectType: 'totem', materials: [{ name: 'plexi' }] }),
      'concept'
    );
    expect(result.source).toMatchObject({ projectType: 'totem', materials: ['plexi'] });
  });

  it('quotes lettering so the model reproduces it rather than inventing wording', () => {
    const result = buildMockupPrompt(spec({ lettering: { text: 'ATLAS' } }), 'concept');
    expect(result.prompt).toContain('"ATLAS"');
  });

  it('omits lighting when the user chose none', () => {
    const result = buildMockupPrompt(spec({ lighting: { type: 'none' } }), 'concept');
    expect(result.prompt).not.toContain('illumination');
  });

  it('asks a site prompt to preserve the existing building', () => {
    const result = buildMockupPrompt(spec({ projectType: 'enseigne' }), 'site');
    // The point of a site mockup is the real building, not a reimagined one.
    expect(result.prompt).toContain('photograph');
    expect(result.prompt).toMatch(/unchanged|keeping/i);
  });

  it('asks a concept prompt for a neutral studio view', () => {
    const result = buildMockupPrompt(spec({ projectType: 'enseigne' }), 'concept');
    expect(result.prompt).toContain('neutral');
  });

  it('produces a usable prompt from an almost-empty specification', () => {
    const result = buildMockupPrompt(spec(), 'concept');
    expect(result.prompt.length).toBeGreaterThan(20);
    expect(result.source).toEqual({});
  });

  it('carries the project proportions into the pixel size', () => {
    const result = buildMockupPrompt(
      spec({ dimensions: { width: 8, height: 3, unit: 'm' } }),
      'concept'
    );
    expect(result.widthPx).toBeGreaterThan(result.heightPx);
  });

  it('is deterministic', () => {
    const s = spec({ projectType: 'enseigne', materials: [{ name: 'alu' }] });
    expect(buildMockupPrompt(s, 'concept')).toEqual(buildMockupPrompt(s, 'concept'));
  });
});
