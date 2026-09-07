import { describe, expect, it } from 'vitest';
import { projectView, projectViews, VIEW_KINDS, VIEW_NEEDS_DEPTH } from './project';
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

describe('front view', () => {
  it('is the canvas as drawn', () => {
    const view = projectView(scene(object()), 'front');
    expect(view.shapes).toHaveLength(1);
    expect(view.shapes[0]).toMatchObject({ x: 0, y: 0, widthMm: 8000, heightMm: 3000 });
    expect(view.unavailableReason).toBeNull();
  });

  it('needs no depth', () => {
    const view = projectView(scene(object()), 'front');
    expect(view.omitted).toHaveLength(0);
  });
});

describe('back view', () => {
  it('mirrors horizontally', () => {
    // Looking from behind, left and right swap. This matters for fixing points
    // and cable exits, so it is not merely cosmetic.
    const view = projectView(
      scene(
        object({ id: 'left', x: 0, widthMm: 1000 }),
        object({ id: 'right', x: 7000, widthMm: 1000 })
      ),
      'back'
    );

    const left = view.shapes.find((s) => s.objectId === 'left')!;
    const right = view.shapes.find((s) => s.objectId === 'right')!;
    expect(left.x).toBe(7000);
    expect(right.x).toBe(0);
  });

  it('keeps vertical position unchanged', () => {
    const view = projectView(scene(object({ y: 500 })), 'back');
    expect(view.shapes[0].y).toBe(500);
  });
});

describe('depth-dependent views', () => {
  it('reports side and top as needing depth', () => {
    expect(VIEW_NEEDS_DEPTH.side).toBe(true);
    expect(VIEW_NEEDS_DEPTH.top).toBe(true);
    expect(VIEW_NEEDS_DEPTH.front).toBe(false);
    expect(VIEW_NEEDS_DEPTH.back).toBe(false);
  });

  it('is unavailable, with a reason, when no object has depth', () => {
    const view = projectView(scene(object()), 'side');
    // A side view drawn without depth would imply a thickness nobody supplied.
    expect(view.shapes).toHaveLength(0);
    expect(view.unavailableReason).toContain('No object has a depth');
  });

  it('draws only the objects that have depth, and names the rest', () => {
    const view = projectView(
      scene(object({ id: 'panel', depthMm: 3 }), object({ id: 'trim', label: 'Trim' })),
      'side'
    );
    expect(view.shapes.map((s) => s.objectId)).toEqual(['panel']);
    expect(view.omitted).toHaveLength(1);
    expect(view.omitted[0].objectId).toBe('trim');
    expect(view.omitted[0].reason).toContain('No depth recorded');
  });

  it('uses depth as the horizontal axis in a side view', () => {
    const view = projectView(scene(object({ depthMm: 40, heightMm: 3000 })), 'side');
    expect(view.horizontalAxis).toBe('depth');
    expect(view.verticalAxis).toBe('height');
    expect(view.shapes[0].widthMm).toBe(40);
    expect(view.shapes[0].heightMm).toBe(3000);
  });

  it('uses depth as the vertical axis in a top view', () => {
    const view = projectView(scene(object({ depthMm: 40, widthMm: 8000 })), 'top');
    expect(view.horizontalAxis).toBe('width');
    expect(view.verticalAxis).toBe('depth');
    expect(view.shapes[0].widthMm).toBe(8000);
    expect(view.shapes[0].heightMm).toBe(40);
  });

  it('stacks parts outward from the wall in scene order', () => {
    // The scene records no z-position, so stacking is the only assumption that
    // adds no false precision about stand-off distance.
    const view = projectView(
      scene(object({ id: 'a', depthMm: 40 }), object({ id: 'b', depthMm: 80 })),
      'side'
    );
    expect(view.shapes[0].x).toBe(0);
    expect(view.shapes[1].x).toBe(40);
  });

  it('ignores a zero or negative depth as if absent', () => {
    const view = projectView(scene(object({ depthMm: 0 })), 'side');
    expect(view.unavailableReason).toContain('No object has a depth');
  });
});

describe('empty scene', () => {
  it('reports every view as unavailable rather than drawing an empty frame', () => {
    for (const kind of VIEW_KINDS) {
      const view = projectView(scene(), kind);
      expect(view.unavailableReason).toBe('The canvas is empty.');
    }
  });
});

describe('projectViews', () => {
  it('projects several views in the requested order', () => {
    const views = projectViews(scene(object({ depthMm: 40 })), ['front', 'side', 'top']);
    expect(views.map((v) => v.kind)).toEqual(['front', 'side', 'top']);
  });

  it('is deterministic', () => {
    const s = scene(object({ depthMm: 40 }), object({ id: 'b', x: 100, depthMm: 20 }));
    expect(projectViews(s, [...VIEW_KINDS])).toEqual(projectViews(s, [...VIEW_KINDS]));
  });
});
