import type { ProjectedView } from './project';
import { VIEW_LABELS } from './project';

/**
 * Renders a set of projected views onto one drawing sheet.
 *
 * Pure and deterministic: the same scene always produces identical markup, which
 * is what lets an issued drawing be stored and reproduced exactly.
 *
 * Colours are literal, not CSS variables: the same markup is rasterised to PNG
 * server-side for production documents, where no stylesheet exists.
 */
const COLOURS = {
  paper: '#ffffff',
  ink: '#111827',
  muted: '#6b7280',
  outline: '#1f2937',
  fill: '#eef2ff',
  dimension: '#9ca3af',
};

export type MaterialLookup = Record<string, string>;

export type DrawingOptions = {
  title: string;
  /** Material id → display name, for the annotation on each part. */
  materials?: MaterialLookup;
  /** Shown in the sheet footer, e.g. an issued version number. */
  reference?: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const formatMm = (mm: number): string =>
  Math.abs(mm) >= 1000 ? `${Number((mm / 1000).toFixed(3))} m` : `${Math.round(mm)} mm`;

type Bounds = { minX: number; minY: number; width: number; height: number };

function boundsOf(view: ProjectedView): Bounds | null {
  if (view.shapes.length === 0) return null;
  const minX = Math.min(...view.shapes.map((s) => s.x));
  const minY = Math.min(...view.shapes.map((s) => s.y));
  const maxX = Math.max(...view.shapes.map((s) => s.x + s.widthMm));
  const maxY = Math.max(...view.shapes.map((s) => s.y + s.heightMm));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Draws one view, translated so its own origin sits at (0,0) of its cell.
 *
 * Each view is scaled independently to fill its cell. A side view is often far
 * shallower than the front is wide, and forcing one shared scale would render it
 * as an unreadable sliver.
 */
function renderView(
  view: ProjectedView,
  cellWidth: number,
  cellHeight: number,
  options: DrawingOptions
): string {
  const bounds = boundsOf(view);
  const parts: string[] = [];
  const titleSize = cellHeight * 0.055;

  parts.push(
    `<text x="0" y="${-titleSize * 0.5}" font-size="${titleSize}" font-weight="600" ` +
      `fill="${COLOURS.ink}">${escapeXml(VIEW_LABELS[view.kind])}</text>`
  );

  if (!bounds || view.unavailableReason) {
    // Stating why is more useful than an empty frame that looks like a mistake.
    parts.push(
      `<rect x="0" y="0" width="${cellWidth}" height="${cellHeight}" fill="none" ` +
        `stroke="${COLOURS.dimension}" stroke-width="${cellHeight * 0.002}" stroke-dasharray="${cellHeight * 0.012} ${cellHeight * 0.008}" />`
    );
    parts.push(
      `<text x="${cellWidth / 2}" y="${cellHeight / 2}" font-size="${titleSize * 0.85}" ` +
        `text-anchor="middle" fill="${COLOURS.muted}">` +
        `${escapeXml(view.unavailableReason ?? 'Nothing to draw.')}</text>`
    );
    return parts.join('\n');
  }

  // Reserve room for the dimension annotations along the bottom and left.
  const margin = Math.min(cellWidth, cellHeight) * 0.13;
  const drawWidth = cellWidth - margin * 2;
  const drawHeight = cellHeight - margin * 2;
  const scale = Math.min(drawWidth / bounds.width, drawHeight / bounds.height);

  const tx = (x: number) => margin + (x - bounds.minX) * scale;
  const ty = (y: number) => margin + (y - bounds.minY) * scale;

  const stroke = Math.max(cellHeight * 0.0018, 0.4);
  const labelSize = titleSize * 0.62;

  // Parts are drawn with a NUMBERED CALLOUT rather than an inline label.
  //
  // Two problems make inline labels unworkable here. Concentric parts — a panel
  // inside its frame — have corners millimetres apart, so their labels overlap.
  // And a top view of an 8 m sign 123 mm deep is a thin strip in which no text
  // fits at all. A number in the shape plus a legend beneath is how a technical
  // drawing has always solved this, and it works at any aspect ratio.
  const legend: string[] = [];
  // Concentric parts put their callouts within a few units of each other, so a
  // number can hide behind the one in front. Placed positions are tracked and a
  // colliding callout is pushed down a line — the same fix the canvas renderer
  // needed for its labels.
  const placedCallouts: { x: number; y: number; size: number }[] = [];

  view.shapes.forEach((shape, index) => {
    const number = index + 1;
    const boxWidth = shape.widthMm * scale;
    const boxHeight = shape.heightMm * scale;

    parts.push(
      `<rect x="${tx(shape.x)}" y="${ty(shape.y)}" width="${boxWidth}" ` +
        `height="${boxHeight}" fill="${COLOURS.fill}" stroke="${COLOURS.outline}" ` +
        `stroke-width="${stroke}" />`
    );

    // The callout only goes inside when the shape can hold it; otherwise the
    // legend still carries the part, so nothing is lost.
    const calloutSize = Math.min(labelSize, boxHeight * 0.7, boxWidth * 0.7);
    if (calloutSize >= labelSize * 0.45) {
      const calloutX = tx(shape.x) + calloutSize * 0.7;
      let calloutY = ty(shape.y) + calloutSize * 1.05;

      while (
        placedCallouts.some(
          (placed) =>
            Math.abs(placed.x - calloutX) < placed.size * 1.2 &&
            Math.abs(placed.y - calloutY) < placed.size * 1.2
        )
      ) {
        calloutY += calloutSize * 1.25;
      }

      placedCallouts.push({ x: calloutX, y: calloutY, size: calloutSize });
      parts.push(
        `<text x="${calloutX}" y="${calloutY}" ` +
          `font-size="${calloutSize}" font-weight="600" fill="${COLOURS.ink}">${number}</text>`
      );
    }

    const materialName = shape.materialId ? options.materials?.[shape.materialId] : undefined;
    const descriptor = [
      shape.label ?? shape.type,
      materialName,
      `${formatMm(shape.widthMm)} × ${formatMm(shape.heightMm)}`,
    ]
      .filter(Boolean)
      .join(' · ');
    legend.push(`${number}  ${descriptor}`);
  });

  // Overall dimension annotations for the view.
  const bottom = ty(bounds.minY + bounds.height);
  const left = tx(bounds.minX);
  const right = tx(bounds.minX + bounds.width);
  const dimOffset = margin * 0.45;

  parts.push(
    `<line x1="${left}" y1="${bottom + dimOffset}" x2="${right}" y2="${bottom + dimOffset}" ` +
      `stroke="${COLOURS.dimension}" stroke-width="${stroke}" />`,
    `<text x="${(left + right) / 2}" y="${bottom + dimOffset + labelSize * 1.2}" ` +
      `font-size="${labelSize}" text-anchor="middle" fill="${COLOURS.muted}">` +
      `${escapeXml(formatMm(bounds.width))} ${view.horizontalAxis}</text>`,

    `<line x1="${left - dimOffset}" y1="${ty(bounds.minY)}" x2="${left - dimOffset}" y2="${bottom}" ` +
      `stroke="${COLOURS.dimension}" stroke-width="${stroke}" />`,
    `<text x="${left - dimOffset - labelSize * 0.4}" y="${(ty(bounds.minY) + bottom) / 2}" ` +
      `font-size="${labelSize}" text-anchor="middle" fill="${COLOURS.muted}" ` +
      `transform="rotate(-90 ${left - dimOffset - labelSize * 0.4} ${(ty(bounds.minY) + bottom) / 2})">` +
      `${escapeXml(formatMm(bounds.height))} ${view.verticalAxis}</text>`
  );

  // Legend beneath the view.
  legend.forEach((entry, index) => {
    parts.push(
      `<text x="0" y="${cellHeight + labelSize * (1.3 + index * 1.15)}" ` +
        `font-size="${labelSize * 0.9}" fill="${COLOURS.ink}">${escapeXml(entry)}</text>`
    );
  });

  if (view.omitted.length > 0) {
    parts.push(
      `<text x="0" y="${cellHeight + labelSize * (1.3 + legend.length * 1.15)}" ` +
        `font-size="${labelSize * 0.85}" fill="${COLOURS.muted}">` +
        `${view.omitted.length} part(s) omitted: no depth recorded</text>`
    );
  }

  return parts.join('\n');
}

export function renderDrawingSheet(views: ProjectedView[], options: DrawingOptions): string {
  if (views.length === 0) return '';

  // A fixed sheet grid in abstract units; each view is scaled into its cell.
  const cellWidth = 1000;
  const cellHeight = 700;
  const gapX = 180;
  // Room beneath each view for its legend, which grows with the part count.
  const maxLegendRows = Math.max(...views.map((view) => view.shapes.length), 1);
  const gapY = 200 + maxLegendRows * 34;
  const columns = views.length === 1 ? 1 : 2;
  const rows = Math.ceil(views.length / columns);

  const headerHeight = cellHeight * 0.16;
  const footerHeight = cellHeight * 0.13;
  const sheetWidth = columns * cellWidth + (columns - 1) * gapX;
  const sheetHeight = rows * cellHeight + (rows - 1) * gapY;
  const pad = cellWidth * 0.06;

  const body = views
    .map((view, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = column * (cellWidth + gapX);
      const y = headerHeight + row * (cellHeight + gapY);
      return `<g transform="translate(${x} ${y})">\n${renderView(view, cellWidth, cellHeight, options)}\n</g>`;
    })
    .join('\n');

  const titleSize = cellHeight * 0.07;
  const footerSize = cellHeight * 0.042;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${-pad} ${-pad} ${sheetWidth + pad * 2} ${sheetHeight + headerHeight + footerHeight + pad * 2}" ` +
    `role="img" aria-label="Technical drawing" preserveAspectRatio="xMidYMid meet">\n` +
    `<rect x="${-pad}" y="${-pad}" width="${sheetWidth + pad * 2}" ` +
    `height="${sheetHeight + headerHeight + footerHeight + pad * 2}" fill="${COLOURS.paper}" />\n` +
    `<text x="0" y="${titleSize}" font-size="${titleSize}" font-weight="700" fill="${COLOURS.ink}">` +
    `${escapeXml(options.title)}</text>\n` +
    body +
    `\n<text x="0" y="${sheetHeight + headerHeight + footerSize * 1.6}" font-size="${footerSize}" ` +
    `fill="${COLOURS.muted}">` +
    // The honesty statement ARCHITECTURE §13 requires, on the drawing itself
    // rather than only in the UI around it.
    `Technical reference drawing generated from project data. Not a certified engineering drawing. ` +
    `Verify dimensions before fabrication.${options.reference ? ` — ${escapeXml(options.reference)}` : ''}` +
    `</text>\n</svg>`
  );
}
