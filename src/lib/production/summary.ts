import type { ProjectSpecData } from '@/lib/spec/schema';
import type {
  ProductionComponent,
  ProductionMounting,
  ProductionSummary,
} from './document';

/**
 * Reads a production summary out of an approved specification.
 *
 * Pure, and deliberately narrow: every function here either finds a value the
 * user or the agent recorded, or returns null. Nothing is derived, defaulted or
 * inferred — a production sheet stating an outdoor rating or a mounting method
 * nobody wrote down would send a workshop to build the wrong thing.
 */

/** "8 × 3 m", "8 × 3 × 0.2 m", or null when no dimensions were recorded. */
export function formatDimensions(spec: ProjectSpecData): string | null {
  const dimensions = spec.dimensions;
  if (!dimensions) return null;

  const parts = [dimensions.width, dimensions.height, dimensions.depth].filter(
    (value): value is number => typeof value === 'number'
  );
  if (parts.length === 0) return null;

  // The unit is part of what was stated. Without it the numbers are ambiguous,
  // and a sign built to the wrong unit is scrap, so say so rather than assume.
  const unit = dimensions.unit ?? null;
  const measurements = parts.map((value) => Number(value.toFixed(3))).join(' × ');
  return unit ? `${measurements} ${unit}` : `${measurements} (unit not recorded)`;
}

/** "led — halo-lit letters", "none", or null. */
export function formatLighting(spec: ProjectSpecData): string | null {
  const lighting = spec.lighting;
  if (!lighting) return null;
  const parts = [lighting.type, lighting.details].filter(
    (value): value is string => typeof value === 'string' && value.trim() !== ''
  );
  return parts.length > 0 ? parts.join(' — ') : null;
}

/** The lettering to produce, with its style, or null. */
export function formatLettering(spec: ProjectSpecData): string | null {
  const lettering = spec.lettering;
  if (!lettering) return null;

  const parts: string[] = [];
  if (lettering.text?.trim()) parts.push(`"${lettering.text.trim()}"`);
  if (lettering.style?.trim()) parts.push(lettering.style.trim());
  if (lettering.colors && lettering.colors.length > 0) parts.push(lettering.colors.join(', '));
  return parts.length > 0 ? parts.join(' — ') : null;
}

export function formatEnvironment(spec: ProjectSpecData): string | null {
  const site = spec.site;
  if (!site) return null;
  const parts = [site.environment, site.locationText].filter(
    (value): value is string => typeof value === 'string' && value.trim() !== ''
  );
  return parts.length > 0 ? parts.join(' — ') : null;
}

export function buildSummary(spec: ProjectSpecData): ProductionSummary {
  return {
    projectType: spec.projectType ?? null,
    dimensions: formatDimensions(spec),
    quantity: spec.quantity ?? null,
    environment: formatEnvironment(spec),
    lighting: formatLighting(spec),
    lettering: formatLettering(spec),
    finishNotes: spec.finishNotes ?? null,
  };
}

export function buildComponents(spec: ProjectSpecData): ProductionComponent[] {
  return (spec.components ?? []).map((component) => ({
    name: component.name,
    quantity: component.quantity ?? null,
    notes: component.notes ?? null,
  }));
}

/**
 * The mounting details, or null when the spec records none.
 *
 * This is as close to assembly guidance as the application can honestly get:
 * the method, the surface and the height somebody actually stated. It is not
 * expanded into steps, because nothing in the system knows the steps.
 */
export function buildMounting(spec: ProjectSpecData): ProductionMounting | null {
  const mounting = spec.mounting;
  if (!mounting) return null;

  const method = mounting.method?.trim() || null;
  const surface = mounting.surface?.trim() || null;
  const height =
    typeof mounting.heightFromGroundM === 'number'
      ? `${Number(mounting.heightFromGroundM.toFixed(3))} m from ground`
      : null;

  if (method === null && surface === null && height === null) return null;
  return { method, surface, heightFromGround: height };
}
