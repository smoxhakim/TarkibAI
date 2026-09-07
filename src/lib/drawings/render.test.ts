import { describe, expect, it } from 'vitest';
import { projectViews } from './project';
import { renderDrawingSheet } from './render';
import { SCENE_VERSION, type CanvasSceneData, type SceneObject } from '@/lib/canvas/schema';

const object = (overrides: Partial<SceneObject> = {}): SceneObject => ({
  id: 'a',
  type: 'panel',
  label: 'Face',
  x: 0,
  y: 0,
  widthMm: 8000,
  heightMm: 3000,
  rotationDeg: 0,
  materialId: null,
  notes: null,
  showDimensions: true,
  ...overrides,
});

const scene = (...objects: SceneObject[]): CanvasSceneData => ({
  sceneVersion: SCENE_VERSION,
  objects,
});

const sheet = (s: CanvasSceneData, kinds: Parameters<typeof projectViews>[1], options = {}) =>
  renderDrawingSheet(projectViews(s, kinds), { title: 'Test project', ...options });

describe('renderDrawingSheet', () => {
  it('renders nothing for no views', () => {
    expect(renderDrawingSheet([], { title: 'x' })).toBe('');
  });

  it('produces an SVG with the project title', () => {
    const svg = sheet(scene(object()), ['front']);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Test project');
  });

  it('labels each view', () => {
    const svg = sheet(scene(object({ depthMm: 40 })), ['front', 'side']);
    expect(svg).toContain('Front elevation');
    expect(svg).toContain('Side view');
  });

  it('always carries the not-certified statement on the drawing itself', () => {
    // ARCHITECTURE §13: never label a drawing CAD-grade. The caveat belongs on
    // the sheet, not only in the UI around it, because the sheet is what gets
    // printed and carried into a workshop.
    const svg = sheet(scene(object()), ['front']);
    expect(svg).toContain('Not a certified engineering drawing');
    expect(svg).toContain('Verify dimensions before fabrication');
  });

  it('states why a view could not be drawn instead of leaving an empty frame', () => {
    const svg = sheet(scene(object()), ['side']);
    expect(svg).toContain('No object has a depth');
  });

  it('annotates parts with their material name in the legend', () => {
    const svg = sheet(scene(object({ materialId: 'm1' })), ['front'], {
      materials: { m1: 'Alucobond 3mm noir' },
    });
    expect(svg).toContain('Alucobond 3mm noir');
  });

  it('shows component labels in the legend', () => {
    const svg = sheet(scene(object({ label: 'Façade principale' })), ['front']);
    expect(svg).toContain('Façade principale');
  });

  it('numbers every part, so concentric parts cannot collide', () => {
    // A panel inside its frame has corners millimetres apart. Inline labels
    // overlapped into unreadable text; numbered callouts cannot.
    const svg = sheet(
      scene(
        object({ id: 'frame', label: 'Cadre', x: -100, y: -100, widthMm: 8200, heightMm: 3200 }),
        object({ id: 'face', label: 'Façade' })
      ),
      ['front']
    );
    expect(svg).toContain('1  Cadre');
    expect(svg).toContain('2  Façade');
  });

  it('keeps a part in the legend even when its shape is too thin for a callout', () => {
    // A 3mm panel in a top view of an 8m sign is a hairline; no number fits
    // inside it, but the part must still be identified.
    const svg = sheet(
      scene(
        object({ id: 'skin', label: 'Alucobond skin', depthMm: 3 }),
        object({ id: 'frame', label: 'Frame', depthMm: 400 })
      ),
      ['top']
    );
    expect(svg).toContain('Alucobond skin');
    expect(svg).toContain('Frame');
  });

  it('includes each part dimension in the legend', () => {
    const svg = sheet(scene(object({ label: 'Face' })), ['front']);
    expect(svg).toContain('8 m × 3 m');
  });

  it('annotates overall dimensions with their axis', () => {
    const svg = sheet(scene(object()), ['front']);
    expect(svg).toContain('8 m width');
    expect(svg).toContain('3 m height');
  });

  it('labels the depth axis in a side view', () => {
    const svg = sheet(scene(object({ depthMm: 40 })), ['side']);
    expect(svg).toContain('depth');
  });

  it('notes how many parts were omitted from a depth view', () => {
    const svg = sheet(scene(object({ id: 'a', depthMm: 40 }), object({ id: 'b' })), ['side']);
    expect(svg).toContain('1 part(s) omitted');
  });

  it('escapes labels so they cannot inject markup', () => {
    const svg = sheet(scene(object({ label: '<script>x</script>' })), ['front']);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('is deterministic, which is what makes an issued drawing reproducible', () => {
    const s = scene(object({ depthMm: 40 }));
    expect(sheet(s, ['front', 'side'])).toBe(sheet(s, ['front', 'side']));
  });

  it('includes a reference when one is given', () => {
    const svg = sheet(scene(object()), ['front'], { reference: 'Drawing 3' });
    expect(svg).toContain('Drawing 3');
  });
});

describe('callout collision', () => {
  it('separates callouts on concentric parts', () => {
    // A frame 100mm outside its panel puts the two callouts within a few units
    // of each other; without stacking the first number is hidden behind the
    // second.
    const svg = sheet(
      scene(
        object({ id: 'frame', label: 'Frame', x: -100, y: -100, widthMm: 8200, heightMm: 3200 }),
        object({ id: 'face', label: 'Face' })
      ),
      ['front']
    );

    const numbers = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="[\d.]+" font-weight="600"/g)].map(
      (m) => ({ x: Number(m[1]), y: Number(m[2]) })
    );
    expect(numbers).toHaveLength(2);
    const distance = Math.abs(numbers[0].y - numbers[1].y);
    expect(distance).toBeGreaterThan(0);
  });

  it('stays deterministic with stacking applied', () => {
    const s = scene(
      object({ id: 'a', label: 'A', x: -100, y: -100, widthMm: 8200, heightMm: 3200 }),
      object({ id: 'b', label: 'B' })
    );
    expect(sheet(s, ['front'])).toBe(sheet(s, ['front']));
  });
});
