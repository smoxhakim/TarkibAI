import { describe, expect, it } from 'vitest';
import { applySceneCommand, applySceneCommands, seedSceneFromSpec } from './commands';
import { SCENE_VERSION, emptyScene, type CanvasSceneData, type SceneObject } from './schema';

let counter = 0;
const ids = () => `id-${++counter}`;

const object = (overrides: Partial<SceneObject> = {}): SceneObject => ({
  id: 'panel-1',
  type: 'panel',
  label: 'Main face',
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

const sceneWith = (...objects: SceneObject[]): CanvasSceneData => ({
  sceneVersion: SCENE_VERSION,
  objects,
});

describe('add_object', () => {
  it('appends an object and generates an id when none is given', () => {
    const result = applySceneCommand(
      emptyScene(),
      { kind: 'add_object', object: { ...object(), id: undefined } },
      () => 'generated-1'
    );
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].id).toBe('generated-1');
  });

  it('honours an explicit id', () => {
    const result = applySceneCommand(emptyScene(), { kind: 'add_object', object: object() }, ids);
    expect(result.objects[0].id).toBe('panel-1');
  });

  it('refuses a duplicate id rather than overwriting silently', () => {
    const scene = sceneWith(object());
    expect(() => applySceneCommand(scene, { kind: 'add_object', object: object() }, ids)).toThrow();
  });

  it('does not mutate the input scene', () => {
    const scene = emptyScene();
    applySceneCommand(scene, { kind: 'add_object', object: object() }, ids);
    expect(scene.objects).toHaveLength(0);
  });
});

describe('update_object', () => {
  it('changes only the named fields', () => {
    const scene = sceneWith(object());
    const result = applySceneCommand(
      scene,
      { kind: 'update_object', id: 'panel-1', changes: { widthMm: 8500 } },
      ids
    );

    expect(result.objects[0].widthMm).toBe(8500);
    // A width change must not erase the label, height or material link.
    expect(result.objects[0].label).toBe('Main face');
    expect(result.objects[0].heightMm).toBe(3000);
  });

  it('ignores undefined values so a sparse patch cannot clear a field', () => {
    const scene = sceneWith(object({ label: 'Keep me' }));
    const result = applySceneCommand(
      scene,
      { kind: 'update_object', id: 'panel-1', changes: { label: undefined, widthMm: 9000 } },
      ids
    );
    expect(result.objects[0].label).toBe('Keep me');
  });

  it('cannot change an object id', () => {
    const scene = sceneWith(object());
    const result = applySceneCommand(
      scene,
      { kind: 'update_object', id: 'panel-1', changes: { widthMm: 100 } },
      ids
    );
    expect(result.objects[0].id).toBe('panel-1');
  });

  it('reports 404 for an unknown object', () => {
    expect(() =>
      applySceneCommand(emptyScene(), { kind: 'update_object', id: 'nope', changes: {} }, ids)
    ).toThrow();
  });

  it('leaves other objects untouched', () => {
    const scene = sceneWith(object(), object({ id: 'panel-2', label: 'Side' }));
    const result = applySceneCommand(
      scene,
      { kind: 'update_object', id: 'panel-1', changes: { widthMm: 1 } },
      ids
    );
    expect(result.objects[1]).toEqual(scene.objects[1]);
  });
});

describe('remove_object', () => {
  it('removes the named object only', () => {
    const scene = sceneWith(object(), object({ id: 'panel-2' }));
    const result = applySceneCommand(scene, { kind: 'remove_object', id: 'panel-1' }, ids);
    expect(result.objects.map((o) => o.id)).toEqual(['panel-2']);
  });

  it('reports 404 rather than silently succeeding on an unknown id', () => {
    expect(() => applySceneCommand(emptyScene(), { kind: 'remove_object', id: 'nope' }, ids)).toThrow();
  });
});

describe('applySceneCommands', () => {
  it('applies a batch in order', () => {
    const result = applySceneCommands(
      emptyScene(),
      [
        { kind: 'add_object', object: object() },
        { kind: 'update_object', id: 'panel-1', changes: { widthMm: 8500 } },
        { kind: 'add_object', object: object({ id: 'panel-2' }) },
        { kind: 'remove_object', id: 'panel-1' },
      ],
      ids
    );
    expect(result.objects.map((o) => o.id)).toEqual(['panel-2']);
  });

  it('throws before applying anything when a later command is invalid', () => {
    const scene = sceneWith(object());
    expect(() =>
      applySceneCommands(
        scene,
        [
          { kind: 'update_object', id: 'panel-1', changes: { widthMm: 9000 } },
          { kind: 'remove_object', id: 'does-not-exist' },
        ],
        ids
      )
    ).toThrow();
    // The caller persists only the returned scene, so the stored one is intact.
    expect(scene.objects[0].widthMm).toBe(8000);
  });
});

describe('seedSceneFromSpec', () => {
  it('creates a panel matching the approved dimensions, converted to millimetres', () => {
    const scene = seedSceneFromSpec(
      { projectType: 'enseigne', dimensions: { width: 8, height: 3, unit: 'm' } },
      ids
    );
    expect(scene?.objects).toHaveLength(1);
    expect(scene?.objects[0].widthMm).toBe(8000);
    expect(scene?.objects[0].heightMm).toBe(3000);
    expect(scene?.objects[0].label).toBe('enseigne');
  });

  it('converts centimetres and millimetres correctly', () => {
    expect(
      seedSceneFromSpec({ dimensions: { width: 250, height: 100, unit: 'cm' } }, ids)?.objects[0]
        .widthMm
    ).toBe(2500);
    expect(
      seedSceneFromSpec({ dimensions: { width: 800, height: 600, unit: 'mm' } }, ids)?.objects[0]
        .widthMm
    ).toBe(800);
  });

  it('adds lettering only when the specification records text', () => {
    const withText = seedSceneFromSpec(
      { dimensions: { width: 8, height: 3, unit: 'm' }, lettering: { text: 'ATLAS' } },
      ids
    );
    expect(withText?.objects).toHaveLength(2);
    expect(withText?.objects[1].type).toBe('lettering');

    const withoutText = seedSceneFromSpec({ dimensions: { width: 8, height: 3, unit: 'm' } }, ids);
    // Inventing lettering the user never specified would put words on a sign
    // that nobody asked for.
    expect(withoutText?.objects).toHaveLength(1);
  });

  it('returns null when there is nothing truthful to draw', () => {
    // No placeholder rectangle: an unknown size is not a size.
    expect(seedSceneFromSpec({ dimensions: { width: 8, unit: 'm' } }, ids)).toBeNull();
    expect(seedSceneFromSpec({ dimensions: { width: 8, height: 3 } }, ids)).toBeNull();
    expect(seedSceneFromSpec({}, ids)).toBeNull();
    expect(seedSceneFromSpec({ dimensions: null }, ids)).toBeNull();
  });

  it('is deterministic given a deterministic id factory', () => {
    let a = 0;
    let b = 0;
    const first = seedSceneFromSpec({ dimensions: { width: 4, height: 2, unit: 'm' } }, () => `x-${++a}`);
    const second = seedSceneFromSpec({ dimensions: { width: 4, height: 2, unit: 'm' } }, () => `x-${++b}`);
    expect(first).toEqual(second);
  });
});
