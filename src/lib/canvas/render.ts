import type { CanvasSceneData, ObjectType, SceneObject } from './schema';

/**
 * Renders a scene to SVG.
 *
 * Pure and deterministic: the same scene always produces the same markup. That
 * matters because this renderer is the foundation the technical-drawing system
 * (T11) and the production document (T14) will build on — a drawing must be
 * reproducible from project data, not regenerated differently each time
 * (ARCHITECTURE §13).
 *
 * This is explicitly NOT an AI-generated picture. Every coordinate traces to a
 * millimetre value in the scene.
 */
export type RenderOptions = {
  /** Padding around the drawing, in millimetres of scene space. */
  paddingMm?: number;
  /** Object to highlight, e.g. the row selected in the edit panel. */
  selectedId?: string | null;
};

export type RenderedScene = {
  svg: string;
  /** Scene bounds in millimetres, useful for showing overall size. */
  bounds: { widthMm: number; heightMm: number } | null;
};

const FILL: Record<ObjectType, string> = {
  panel: 'var(--canvas-panel)',
  frame: 'none',
  lettering: 'var(--canvas-lettering)',
  light: 'var(--canvas-light)',
  note: 'none',
};

const STROKE: Record<ObjectType, string> = {
  panel: 'var(--canvas-ink)',
  frame: 'var(--canvas-ink)',
  lettering: 'var(--canvas-ink)',
  light: 'var(--canvas-ink)',
  note: 'var(--canvas-muted)',
};

const DASHED: ObjectType[] = ['note', 'light'];

/**
 * Where an object's label is drawn.
 *
 * Structural objects (a panel, its frame, a note) are typically concentric, so
 * centring all of their labels stacks them into unreadable overlap. Only
 * objects whose label IS their content — lettering, a light — are centred; the
 * rest are labelled at their top-left corner, where nesting separates them
 * naturally.
 */
const CENTRED_LABEL: ObjectType[] = ['lettering', 'light'];

/** Escapes text before it is placed in markup. Labels are user input. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Millimetres to a short label: 8000 -> "8 m", 850 -> "850 mm". */
export function formatMm(mm: number): string {
  if (Math.abs(mm) >= 1000) return `${Number((mm / 1000).toFixed(3))} m`;
  return `${mm} mm`;
}

export function sceneBounds(scene: CanvasSceneData): { widthMm: number; heightMm: number } | null {
  if (scene.objects.length === 0) return null;

  const minX = Math.min(...scene.objects.map((o) => o.x));
  const minY = Math.min(...scene.objects.map((o) => o.y));
  const maxX = Math.max(...scene.objects.map((o) => o.x + o.widthMm));
  const maxY = Math.max(...scene.objects.map((o) => o.y + o.heightMm));

  return { widthMm: maxX - minX, heightMm: maxY - minY };
}

/**
 * Chooses a y for each corner-anchored label, pushing a label down a line when
 * it would collide with one already placed.
 *
 * Nested structural objects — a panel inside its frame — have corners only
 * millimetres apart, which is far less than a line of text, so their labels
 * overlapped into unreadable mush. Resolved geometrically rather than by
 * hiding a label, so no information is lost.
 */
function planCornerLabels(
  objects: SceneObject[],
  fontSize: number
): Map<string, number> {
  const lineHeight = fontSize * 1.15;
  const inset = fontSize * 0.5;
  const placed: { x: number; y: number; width: number }[] = [];
  const plan = new Map<string, number>();

  for (const object of objects) {
    if (!object.label || CENTRED_LABEL.includes(object.type)) continue;

    let y = object.y + inset + fontSize * 0.9;
    // Rough text width; exact metrics are not available server-side and are not
    // needed, since this only decides whether two labels are near each other.
    const width = object.label.length * fontSize * 0.55;

    let collides = true;
    while (collides) {
      collides = placed.some(
        (other) =>
          Math.abs(other.y - y) < lineHeight &&
          object.x < other.x + other.width &&
          other.x < object.x + width
      );
      if (collides) y += lineHeight;
    }

    placed.push({ x: object.x, y, width });
    plan.set(object.id, y);
  }

  return plan;
}

function renderObject(
  object: SceneObject,
  strokeWidth: number,
  fontSize: number,
  selected: boolean,
  cornerLabelY: number | undefined
): string {
  const centreX = object.x + object.widthMm / 2;
  const centreY = object.y + object.heightMm / 2;
  const transform =
    object.rotationDeg !== 0
      ? ` transform="rotate(${object.rotationDeg} ${centreX} ${centreY})"`
      : '';

  const dash = DASHED.includes(object.type) ? ` stroke-dasharray="${strokeWidth * 4} ${strokeWidth * 3}"` : '';
  const selectionStroke = selected ? 'var(--canvas-accent)' : STROKE[object.type];
  const selectionWidth = selected ? strokeWidth * 2 : strokeWidth;

  const parts = [
    `<rect x="${object.x}" y="${object.y}" width="${object.widthMm}" height="${object.heightMm}" ` +
      `fill="${FILL[object.type]}" stroke="${selectionStroke}" stroke-width="${selectionWidth}"${dash}${transform} />`,
  ];

  if (object.label) {
    if (CENTRED_LABEL.includes(object.type)) {
      parts.push(
        `<text x="${centreX}" y="${centreY}" font-size="${fontSize}" text-anchor="middle" ` +
          `dominant-baseline="middle" fill="var(--canvas-ink)"${transform}>${escapeXml(object.label)}</text>`
      );
    } else {
      // Inset from the top-left corner, on the line planned for it so nested
      // rectangles stay legible.
      const inset = fontSize * 0.5;
      const y = cornerLabelY ?? object.y + inset + fontSize * 0.9;
      parts.push(
        `<text x="${object.x + inset}" y="${y}" font-size="${fontSize}" ` +
          `text-anchor="start" fill="var(--canvas-ink)"${transform}>${escapeXml(object.label)}</text>`
      );
    }
  }

  return parts.join('\n');
}

/** Dimension annotation drawn beneath and to the left of an object. */
function renderDimensions(object: SceneObject, strokeWidth: number, fontSize: number): string {
  const offset = fontSize * 1.4;
  const bottom = object.y + object.heightMm;
  const tick = fontSize * 0.4;

  return [
    // Width, below the object.
    `<line x1="${object.x}" y1="${bottom + offset}" x2="${object.x + object.widthMm}" y2="${bottom + offset}" ` +
      `stroke="var(--canvas-muted)" stroke-width="${strokeWidth}" />`,
    `<line x1="${object.x}" y1="${bottom + offset - tick}" x2="${object.x}" y2="${bottom + offset + tick}" stroke="var(--canvas-muted)" stroke-width="${strokeWidth}" />`,
    `<line x1="${object.x + object.widthMm}" y1="${bottom + offset - tick}" x2="${object.x + object.widthMm}" y2="${bottom + offset + tick}" stroke="var(--canvas-muted)" stroke-width="${strokeWidth}" />`,
    `<text x="${object.x + object.widthMm / 2}" y="${bottom + offset + fontSize * 1.3}" font-size="${fontSize}" ` +
      `text-anchor="middle" fill="var(--canvas-muted)">${escapeXml(formatMm(object.widthMm))}</text>`,

    // Height, to the left, rotated to read along the edge.
    `<line x1="${object.x - offset}" y1="${object.y}" x2="${object.x - offset}" y2="${bottom}" ` +
      `stroke="var(--canvas-muted)" stroke-width="${strokeWidth}" />`,
    `<text x="${object.x - offset - fontSize * 0.5}" y="${object.y + object.heightMm / 2}" font-size="${fontSize}" ` +
      `text-anchor="middle" fill="var(--canvas-muted)" ` +
      `transform="rotate(-90 ${object.x - offset - fontSize * 0.5} ${object.y + object.heightMm / 2})">` +
      `${escapeXml(formatMm(object.heightMm))}</text>`,
  ].join('\n');
}

export function renderScene(scene: CanvasSceneData, options: RenderOptions = {}): RenderedScene {
  const bounds = sceneBounds(scene);
  if (!bounds || scene.objects.length === 0) {
    return { svg: '', bounds: null };
  }

  const minX = Math.min(...scene.objects.map((o) => o.x));
  const minY = Math.min(...scene.objects.map((o) => o.y));

  // Padding scales with the drawing so annotations fit on both a 300 mm sign
  // and an 8 m facade without hard-coding a size.
  const padding = options.paddingMm ?? Math.max(bounds.widthMm, bounds.heightMm) * 0.14;
  const viewWidth = bounds.widthMm + padding * 2;
  const viewHeight = bounds.heightMm + padding * 2;

  // Stroke and font are expressed in scene units so they render at a consistent
  // visual weight whatever the real-world size of the project.
  const scale = Math.max(viewWidth, viewHeight);
  const strokeWidth = scale * 0.002;
  const fontSize = scale * 0.03;

  const cornerLabels = planCornerLabels(scene.objects, fontSize);

  const body = scene.objects
    .map((object) => {
      const shape = renderObject(
        object,
        strokeWidth,
        fontSize,
        object.id === options.selectedId,
        cornerLabels.get(object.id)
      );
      const dims = object.showDimensions ? renderDimensions(object, strokeWidth, fontSize) : '';
      return [shape, dims].filter(Boolean).join('\n');
    })
    .join('\n');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - padding} ${minY - padding} ${viewWidth} ${viewHeight}" ` +
    `role="img" aria-label="Project canvas" preserveAspectRatio="xMidYMid meet">\n${body}\n</svg>`;

  return { svg, bounds };
}
