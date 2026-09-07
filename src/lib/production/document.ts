import type { EmbeddedImage } from '@/lib/pdf/image';

/**
 * The shape of a production package.
 *
 * Everything on this type comes from something the project actually records: a
 * drawing that was issued, a requirement the user stated, a plan an engine
 * computed, a field of the approved specification. There is no field for
 * inferred assembly steps, suggested tooling, or a recommended build order,
 * because the application has no knowledge of how a sign is assembled and
 * printing a plausible-looking sequence for a workshop to follow would be the
 * most dangerous kind of invented content in the product (PRD 5.3).
 *
 * Where something is missing, the type carries a reason rather than an absence,
 * so the page can say "no mounting method recorded" instead of leaving a gap
 * the reader fills in themselves.
 *
 * No money appears anywhere on it. The shop floor needs quantities and
 * specifications; a package that reaches a subcontractor should not carry the
 * business's costs. `assertNoPricing` enforces that on the way to the renderer.
 */

export type ProductionVersions = {
  specVersion: number | null;
  /** False when the latest specification is still a draft — the sheet says so,
   *  because building to an unapproved spec is a decision, not a detail. */
  specApproved: boolean;
  specApprovedAt: string | null;
  drawingVersion: number | null;
  materialsCalculatedAt: string | null;
};

export type ProductionSummary = {
  projectType: string | null;
  /** Formatted from the spec's own dimensions and unit, e.g. "8 × 3 m". */
  dimensions: string | null;
  quantity: number | null;
  environment: string | null;
  lighting: string | null;
  lettering: string | null;
  finishNotes: string | null;
};

export type ProductionComponent = {
  name: string;
  quantity: number | null;
  notes: string | null;
};

export type ProductionMaterial = {
  name: string;
  role: string | null;
  supplier: string | null;
  /** The size the material is bought in, e.g. "2.44 m × 1.22 m". */
  stockSize: string | null;
  thickness: string | null;
  /** What the user said the project needs, with its unit. */
  required: string | null;
  /** Whole stock units to buy. Null when the line was never calculated. */
  unitsToPurchase: number | null;
  purchased: string | null;
  waste: string | null;
  /** Why this line has no numbers, when it has none. */
  unsupportedReason: string | null;
  /** Caveats the calculation itself recorded, carried through verbatim. */
  warnings: string[];
};

export type ProductionCuttingPlan = {
  materialName: string;
  kind: 'sheet' | 'linear';
  stockSizeLabel: string;
  stockUnitsUsed: number;
  wastePercent: string;
  kerfMm: number;
  edgeMarginMm: number;
  /** Pieces the optimiser could not place, with the reason it gave. */
  unplaced: { label: string; reason: string }[];
  /**
   * One image per stock unit for a sheet plan, one image overall for a linear
   * plan.
   *
   * A five-sheet plan drawn as a single tall figure has to be shrunk to fit the
   * page height, and its piece labels then become unreadable — a cutting plan
   * nobody can cut from. Split per sheet, each figure is roughly 2:1 and uses
   * the full width. Linear plans are already wide and short, so they stay whole.
   */
  images: EmbeddedImage[];
};

export type ProductionMounting = {
  method: string | null;
  surface: string | null;
  heightFromGround: string | null;
};

export type ProductionDocument = {
  reference: string;
  generatedAt: string;
  projectTitle: string;

  versions: ProductionVersions;
  summary: ProductionSummary;

  /** The issued drawing, rasterised. */
  drawing: { reference: string; image: EmbeddedImage } | null;
  /** Why there is no drawing, when there is none. */
  drawingUnavailableReason: string | null;

  components: ProductionComponent[];
  materials: ProductionMaterial[];
  cuttingPlans: ProductionCuttingPlan[];

  /** Recorded mounting details. Null when the spec says nothing about it. */
  mounting: ProductionMounting | null;

  /** Instructions the user wrote for the workshop. */
  notes: string | null;
};

/**
 * Field names that must not appear on a production package.
 *
 * The same reasoning as the quote's client-safe guard, applied to a different
 * boundary: this document goes to whoever builds the job, which may be someone
 * outside the business.
 */
export const PRICING_FIELD_NAMES = [
  'unitPriceCents',
  'unitPriceCentsSnapshot',
  'totalCostCents',
  'materialsCostCents',
  'laborCostCents',
  'internalTotalCents',
  'marginCents',
  'clientTotalCents',
  'subtotalCents',
] as const;

/** Throws if a priced field has been attached to a production document. */
export function assertNoPricing(document: ProductionDocument): void {
  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if ((PRICING_FIELD_NAMES as readonly string[]).includes(key)) {
        throw new Error(
          `Pricing data reached the production package at ${path}.${key}. A workshop document must not carry it.`
        );
      }
      walk(child, `${path}.${key}`);
    }
  };

  walk(document, 'package');
}
