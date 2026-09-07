import type { CanvasSceneData, SceneObject } from '@/lib/canvas/schema';

/**
 * Orthographic projection of the canvas into standard views.
 *
 * # What this is, and is not
 *
 * These are TECHNICAL REFERENCE drawings generated from validated project
 * geometry — every coordinate traces to a millimetre the user stated. They are
 * not CAD output and are not certified engineering drawings, and the renderer
 * labels them accordingly (ARCHITECTURE §13).
 *
 * # Views and the depth problem
 *
 * The canvas is a front elevation: objects have width and height only. Front and
 * back need nothing more. Side and top need DEPTH, which most objects will not
 * have. An object without a depth is omitted from those views and reported, so
 * a side view never implies a thickness nobody supplied.
 */
export const VIEW_KINDS = ['front', 'back', 'top', 'side'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export const VIEW_LABELS: Record<ViewKind, string> = {
  front: 'Front elevation',
  back: 'Back elevation',
  top: 'Top view',
  side: 'Side view',
};

/** Whether a view needs depth to be meaningful. */
export const VIEW_NEEDS_DEPTH: Record<ViewKind, boolean> = {
  front: false,
  back: false,
  top: true,
  side: true,
};

export type ProjectedShape = {
  objectId: string;
  label: string | null;
  type: string;
  materialId: string | null;
  x: number;
  y: number;
  widthMm: number;
  heightMm: number;
};

export type ProjectedView = {
  kind: ViewKind;
  shapes: ProjectedShape[];
  /** Axis labels, so a reader knows what the two dimensions mean. */
  horizontalAxis: 'width' | 'depth';
  verticalAxis: 'height' | 'depth';
  /** Objects left out because they carry no depth. */
  omitted: { objectId: string; label: string | null; reason: string }[];
  /** True when the view cannot be drawn at all. */
  unavailableReason: string | null;
};

const shapeFrom = (
  object: SceneObject,
  x: number,
  y: number,
  widthMm: number,
  heightMm: number
): ProjectedShape => ({
  objectId: object.id,
  label: object.label ?? null,
  type: object.type,
  materialId: object.materialId ?? null,
  x,
  y,
  widthMm,
  heightMm,
});

export function projectView(scene: CanvasSceneData, kind: ViewKind): ProjectedView {
  const objects = scene.objects;

  if (objects.length === 0) {
    return {
      kind,
      shapes: [],
      horizontalAxis: kind === 'side' ? 'depth' : 'width',
      verticalAxis: kind === 'top' ? 'depth' : 'height',
      omitted: [],
      unavailableReason: 'The canvas is empty.',
    };
  }

  if (!VIEW_NEEDS_DEPTH[kind]) {
    // Front is the canvas as drawn. Back is its mirror: looking from behind,
    // left and right swap, which matters for fixing points and cable exits.
    const maxX = Math.max(...objects.map((o) => o.x + o.widthMm));
    const minX = Math.min(...objects.map((o) => o.x));

    const shapes = objects.map((object) =>
      kind === 'front'
        ? shapeFrom(object, object.x, object.y, object.widthMm, object.heightMm)
        : shapeFrom(
            object,
            minX + (maxX - (object.x + object.widthMm)),
            object.y,
            object.widthMm,
            object.heightMm
          )
    );

    return {
      kind,
      shapes,
      horizontalAxis: 'width',
      verticalAxis: 'height',
      omitted: [],
      unavailableReason: null,
    };
  }

  // Depth-dependent views. Objects are stacked from the wall outward in the
  // order they appear, because the scene records no z-position — a genuine
  // limitation, and stacking is the only assumption that adds no false precision
  // about how far a part stands off the wall.
  const withDepth = objects.filter((object) => object.depthMm != null && object.depthMm > 0);
  const omitted = objects
    .filter((object) => object.depthMm == null || object.depthMm <= 0)
    .map((object) => ({
      objectId: object.id,
      label: object.label ?? null,
      reason: 'No depth recorded, so it cannot be drawn in this view.',
    }));

  if (withDepth.length === 0) {
    return {
      kind,
      shapes: [],
      horizontalAxis: kind === 'side' ? 'depth' : 'width',
      verticalAxis: kind === 'top' ? 'depth' : 'height',
      omitted,
      unavailableReason:
        'No object has a depth. Add a depth to the parts that need one to draw this view.',
    };
  }

  let offset = 0;
  const shapes: ProjectedShape[] = [];

  for (const object of withDepth) {
    const depth = object.depthMm as number;

    if (kind === 'side') {
      // Horizontal is depth, vertical is height.
      shapes.push(shapeFrom(object, offset, object.y, depth, object.heightMm));
    } else {
      // Top: horizontal is width, vertical is depth.
      shapes.push(shapeFrom(object, object.x, offset, object.widthMm, depth));
    }
    offset += depth;
  }

  return {
    kind,
    shapes,
    horizontalAxis: kind === 'side' ? 'depth' : 'width',
    verticalAxis: kind === 'top' ? 'depth' : 'height',
    omitted,
    unavailableReason: null,
  };
}

export function projectViews(scene: CanvasSceneData, kinds: ViewKind[]): ProjectedView[] {
  return kinds.map((kind) => projectView(scene, kind));
}
