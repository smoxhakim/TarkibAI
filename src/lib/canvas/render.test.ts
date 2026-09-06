import { describe, expect, it } from 'vitest';
import { formatMm, renderScene, sceneBounds } from './render';
import { SCENE_VERSION, emptyScene, type CanvasSceneData, type SceneObject } from './schema';

const object = (overrides: Partial<SceneObject> = {}): SceneObject => ({
  id: 'a',
  type: 'panel',
  label: null,
  x: 0,
  y: 0,
  widthMm: 8000,
  heightMm: 3000,
  rotationDeg: 0,
  materialId: null,
  notes: null,
  showDimensions: false,
  ...overrides,
});

const scene = (...objects: SceneObject[]): CanvasSceneData => ({
  sceneVersion: SCENE_VERSION,
  objects,
});

describe('formatMm', () => {
  it('uses metres at and above a metre', () => {
    expect(formatMm(8000)).toBe('8 m');
    expect(formatMm(2440)).toBe('2.44 m');
  });

  it('uses millimetres below a metre', () => {
    expect(formatMm(850)).toBe('850 mm');
  });
});

describe('sceneBounds', () => {
  it('is null for an empty scene', () => {
    expect(sceneBounds(emptyScene())).toBeNull();
  });

  it('spans all objects, including negative coordinates', () => {
    const bounds = sceneBounds(scene(object(), object({ id: 'b', x: -1000, y: -500, widthMm: 500, heightMm: 500 })));
    expect(bounds).toEqual({ widthMm: 9000, heightMm: 3500 });
  });
});

describe('renderScene', () => {
  it('produces no markup for an empty scene rather than an empty box', () => {
    const result = renderScene(emptyScene());
    expect(result.svg).toBe('');
    expect(result.bounds).toBeNull();
  });

  it('emits a viewBox derived from real millimetre geometry', () => {
    const result = renderScene(scene(object()));
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('viewBox=');
    expect(result.bounds).toEqual({ widthMm: 8000, heightMm: 3000 });
  });

  it('is deterministic — the same scene always renders identically', () => {
    // The renderer is the foundation for technical drawings, which must be
    // reproducible from project data rather than regenerated differently.
    expect(renderScene(scene(object())).svg).toBe(renderScene(scene(object())).svg);
  });

  it('escapes label text so a label cannot inject markup', () => {
    const result = renderScene(scene(object({ label: '<script>alert(1)</script>' })));
    expect(result.svg).not.toContain('<script>');
    expect(result.svg).toContain('&lt;script&gt;');
  });

  it('escapes quotes and ampersands in labels', () => {
    const result = renderScene(scene(object({ label: 'Café "A" & B' })));
    expect(result.svg).toContain('&amp;');
    expect(result.svg).toContain('&quot;');
  });

  it('draws dimension annotations only when the object asks for them', () => {
    const without = renderScene(scene(object({ showDimensions: false })));
    const with_ = renderScene(scene(object({ showDimensions: true })));
    expect(without.svg).not.toContain('8 m');
    expect(with_.svg).toContain('8 m');
  });

  it('applies rotation as a transform rather than recomputing geometry', () => {
    const result = renderScene(scene(object({ rotationDeg: 90 })));
    expect(result.svg).toContain('rotate(90');
  });

  it('highlights the selected object', () => {
    const plain = renderScene(scene(object()));
    const selected = renderScene(scene(object()), { selectedId: 'a' });
    expect(selected.svg).not.toBe(plain.svg);
    expect(selected.svg).toContain('--canvas-accent');
  });

  it('scales annotation sizing with the drawing, not with a fixed pixel size', () => {
    // A 300 mm sign and an 8 m facade must both be legible.
    const small = renderScene(scene(object({ widthMm: 300, heightMm: 200, showDimensions: true })));
    const large = renderScene(scene(object({ showDimensions: true })));
    expect(small.svg).toContain('300 mm');
    expect(large.svg).toContain('8 m');
  });
});

describe('label placement', () => {
  it('centres a lettering label, because the label is the content', () => {
    const result = renderScene(scene(object({ type: 'lettering', label: 'ATLAS' })));
    expect(result.svg).toContain('text-anchor="middle"');
  });

  it('corners a panel or frame label so nested objects do not overlap', () => {
    // A panel, its frame and its lettering are concentric; centring all three
    // stacked them into unreadable mush.
    for (const type of ['panel', 'frame', 'note'] as const) {
      const result = renderScene(scene(object({ type, label: 'Cadre acier' })));
      expect(result.svg).toContain('text-anchor="start"');
    }
  });

  it('keeps concentric objects legible by separating their label anchors', () => {
    const result = renderScene(
      scene(
        object({ id: 'p', type: 'panel', label: 'Face' }),
        object({ id: 'f', type: 'frame', label: 'Frame', x: -100, y: -100, widthMm: 8200, heightMm: 3200 }),
        object({ id: 'l', type: 'lettering', label: 'ATLAS', x: 1200, y: 1000, widthMm: 5600, heightMm: 900 })
      )
    );
    // Two corner-anchored structural labels plus one centred lettering label.
    expect((result.svg.match(/text-anchor="start"/g) ?? []).length).toBe(2);
    expect((result.svg.match(/text-anchor="middle"/g) ?? []).length).toBe(1);
  });
});

describe('corner label collision', () => {
  it('stacks labels of nested objects onto separate lines', () => {
    // A frame 100mm outside its panel puts their corners far closer together
    // than a line of text; without stacking the two labels overlapped.
    const result = renderScene(
      scene(
        object({ id: 'frame', type: 'frame', label: 'Cadre acier', x: -100, y: -100, widthMm: 8200, heightMm: 3200 }),
        object({ id: 'panel', type: 'panel', label: 'Enseigne' })
      )
    );

    const ys = [...result.svg.matchAll(/<text x="[^"]+" y="([\d.-]+)"[^>]*text-anchor="start"/g)].map(
      (m) => Number(m[1])
    );
    expect(ys).toHaveLength(2);
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThan(0);
  });

  it('does not shift labels that are far apart', () => {
    const result = renderScene(
      scene(
        object({ id: 'a', type: 'panel', label: 'Top', x: 0, y: 0, widthMm: 1000, heightMm: 1000 }),
        object({ id: 'b', type: 'panel', label: 'Bottom', x: 0, y: 5000, widthMm: 1000, heightMm: 1000 })
      )
    );
    const ys = [...result.svg.matchAll(/<text x="[^"]+" y="([\d.-]+)"[^>]*text-anchor="start"/g)].map(
      (m) => Number(m[1])
    );
    // The second label stays on its own object, not pushed down by the first.
    expect(ys[1]).toBeGreaterThan(5000);
  });

  it('stays deterministic with stacking applied', () => {
    const build = () =>
      renderScene(
        scene(
          object({ id: 'f', type: 'frame', label: 'Frame', x: -100, y: -100, widthMm: 8200, heightMm: 3200 }),
          object({ id: 'p', type: 'panel', label: 'Panel' })
        )
      ).svg;
    expect(build()).toBe(build());
  });
});
