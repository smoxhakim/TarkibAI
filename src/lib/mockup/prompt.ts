import type { ProjectSpecData } from '@/lib/spec/schema';
import type { DomainProfile } from '@/lib/domains/types';

/**
 * Builds an image prompt from the project's structured specification.
 *
 * Only facts the user actually stated are used. The prompt never invents a
 * material, colour or dimension, because a mockup that shows something nobody
 * specified will be read as a proposal and argued about with a client.
 *
 * A mockup remains a presentation aid: the prompt asks for a realistic
 * visualisation, and nothing derived from the result may feed a calculation
 * (PRD §17).
 */
export type PromptResult = {
  prompt: string;
  /** The spec facts that went into it, stored for auditability. */
  source: Record<string, unknown>;
  /** Suggested pixel dimensions, following the project's real proportions. */
  widthPx: number;
  heightPx: number;
};

const MAX_EDGE = 1440;
/**
 * Absolute floor for the short edge.
 *
 * Deliberately low, because the ratio is what matters. An early version floored
 * this at 768 and silently squared an 8 × 3 m sign off to 1.875:1; raising it to
 * 320 still could not express a 6 m × 1 m fascia band, which is an entirely
 * ordinary piece of signage. At 128 the expressible range reaches about 11:1,
 * which covers real work.
 *
 * Beyond that the ratio IS distorted — there is no way to be both true to
 * proportion and inside a model's size limits — and the result will look
 * squarer than the real sign.
 */
const MIN_EDGE = 128;

/**
 * Pixel dimensions that follow the real aspect ratio.
 *
 * An 8 × 3 m sign rendered square would show a sign nobody is buying, so the
 * proportion is carried through rather than defaulted.
 */
export function pixelDimensions(widthMm?: number | null, heightMm?: number | null): {
  widthPx: number;
  heightPx: number;
} {
  if (!widthMm || !heightMm || widthMm <= 0 || heightMm <= 0) {
    return { widthPx: 1024, heightPx: 1024 };
  }

  const ratio = widthMm / heightMm;
  const round16 = (value: number) => Math.round(value / 16) * 16;

  // Long edge at the maximum, short edge derived so the ratio is preserved.
  let longEdge = MAX_EDGE;
  let shortEdge = MAX_EDGE / Math.max(ratio, 1 / ratio);

  if (shortEdge < MIN_EDGE) {
    // Only for ratios beyond roughly 4.5:1 does the floor bind. The long edge
    // is pulled in to keep as much of the true proportion as the limits allow.
    shortEdge = MIN_EDGE;
    longEdge = Math.min(MAX_EDGE, MIN_EDGE * Math.max(ratio, 1 / ratio));
  }

  return ratio >= 1
    ? { widthPx: round16(longEdge), heightPx: round16(shortEdge) }
    : { widthPx: round16(shortEdge), heightPx: round16(longEdge) };
}

const UNIT_TO_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000 };

function describeDimensions(spec: ProjectSpecData): string | null {
  const d = spec.dimensions;
  if (!d?.width || !d?.height || !d.unit) return null;
  return `${d.width}${d.unit} wide by ${d.height}${d.unit} high`;
}

export function buildMockupPrompt(
  spec: ProjectSpecData,
  kind: 'concept' | 'site',
  domain: DomainProfile
): PromptResult {
  const facts: string[] = [];
  const source: Record<string, unknown> = {};

  const projectType = spec.projectType?.trim();
  if (projectType) {
    facts.push(projectType);
    source.projectType = projectType;
  }

  const dimensions = describeDimensions(spec);
  if (dimensions) {
    facts.push(dimensions);
    source.dimensions = spec.dimensions;
  }

  const materials = (spec.materials ?? []).map((material) => material.name).filter(Boolean);
  if (materials.length > 0) {
    facts.push(`made from ${materials.join(', ')}`);
    source.materials = materials;
  }

  if (spec.lettering?.text) {
    // Quoted so the model reproduces the text rather than inventing wording.
    facts.push(`with the text "${spec.lettering.text}"`);
    source.lettering = spec.lettering.text;
  }

  if (spec.lighting?.type && spec.lighting.type !== 'none') {
    facts.push(`${spec.lighting.type} illumination`);
    source.lighting = spec.lighting.type;
  }

  if (spec.mounting?.method) {
    facts.push(`mounted by ${spec.mounting.method}`);
    source.mounting = spec.mounting.method;
  }

  if (spec.site?.environment) {
    facts.push(`${spec.site.environment} installation`);
    source.environment = spec.site.environment;
  }

  if (spec.finishNotes) {
    facts.push(spec.finishNotes);
    source.finishNotes = spec.finishNotes;
  }

  // The fallback names the trade rather than always saying "sign". It is only
  // ever reached when the specification records nothing at all, and generation
  // is already refused in that case — but a joinery project should not describe
  // itself as signage on the way to being refused.
  const description = facts.length > 0 ? facts.join(', ') : domain.mockupSubject;

  const prompt =
    kind === 'site'
      ? `Photorealistic visualisation: install this ${domain.noun.singular} in the photographed ` +
        `location, keeping the existing architecture, lighting and perspective unchanged. It is ` +
        `${description}. Blend it naturally into the scene at a realistic scale.`
      : `Professional product visualisation of ${description}. Clean neutral studio background, ` +
        `straight-on view, realistic materials and lighting, no people, no extra text beyond what is specified.`;

  const unit = spec.dimensions?.unit ? UNIT_TO_MM[spec.dimensions.unit] : undefined;
  const { widthPx, heightPx } = pixelDimensions(
    spec.dimensions?.width && unit ? spec.dimensions.width * unit : null,
    spec.dimensions?.height && unit ? spec.dimensions.height * unit : null
  );

  return { prompt, source, widthPx, heightPx };
}
