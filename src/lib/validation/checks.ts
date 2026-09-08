import type { LengthUnit, ProjectSpecData } from '@/lib/spec/schema';
import type { DomainProfile } from '@/lib/domains/types';

/**
 * Deterministic integrity checks over project data.
 *
 * Pure: plain data in, findings out, no database and no model. These are the
 * questions "is this internally consistent, and is anything downstream of it
 * out of date" — never "is this a good design", which the system has no basis
 * to answer.
 *
 * # Severity is a promise about what happens next
 *
 * `blocker`  — an action is refused. Reserved for cases where proceeding would
 *              produce a document carrying numbers that are known to be wrong.
 * `warning`  — the action proceeds, but the user is told first. Anything that
 *              is merely unusual lives here: the system must not refuse a
 *              legitimately strange project because it has never seen one.
 * `note`     — worth knowing, no action implied.
 *
 * A plausibility check is never a blocker. An 80 m sign is unusual, not
 * impossible, and refusing it would mean the tool decides what the user is
 * allowed to build.
 */

export type Severity = 'blocker' | 'warning' | 'note';

export type FindingArea =
  | 'specification'
  | 'design'
  | 'materials'
  | 'cutting'
  | 'cost'
  | 'documents';

export type Finding = {
  /** Stable identifier, so a finding can be tested and referred to. */
  code: string;
  severity: Severity;
  area: FindingArea;
  /** What is wrong, in a sentence. */
  message: string;
  /** What to do about it, or null when there is nothing to do. */
  action: string | null;
  /** What it is about — a material name, a view, a line. */
  subject: string | null;
};

const MM_PER: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000 };

/* -------------------------------------------------------------------------- */
/* Specification                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Plausibility bounds come from the project's trade (T17).
 *
 * The same number means different things in different work: a twelve-metre run
 * is ordinary signage and a very large piece of joinery. Bounds are chosen wide
 * in every domain — they exist to catch a slipped decimal, not to police what
 * someone builds — and they only ever produce warnings.
 */
export function checkDimensions(spec: ProjectSpecData, domain: DomainProfile): Finding[] {
  const {
    implausiblyLargeMm: IMPLAUSIBLY_LARGE_MM,
    implausiblySmallMm: IMPLAUSIBLY_SMALL_MM,
    extremeAspectRatio: EXTREME_ASPECT_RATIO,
    longThinExample,
  } = domain.dimensionBounds;

  const dimensions = spec.dimensions;
  if (!dimensions) return [];

  const unit = dimensions.unit ?? null;
  if (unit === null) {
    const stated = [dimensions.width, dimensions.height, dimensions.depth].some(
      (value) => typeof value === 'number'
    );
    return stated
      ? [
          {
            code: 'dimensions.no_unit',
            severity: 'warning',
            area: 'specification',
            message: 'The dimensions have no unit recorded, so the numbers are ambiguous.',
            action: 'Confirm whether they are millimetres, centimetres or metres.',
            subject: null,
          },
        ]
      : [];
  }

  const scale = MM_PER[unit];
  const named: [string, number | null | undefined][] = [
    ['Width', dimensions.width],
    ['Height', dimensions.height],
    ['Depth', dimensions.depth],
  ];

  const findings: Finding[] = [];
  for (const [label, value] of named) {
    if (typeof value !== 'number') continue;
    const mm = value * scale;

    if (mm > IMPLAUSIBLY_LARGE_MM) {
      findings.push({
        code: 'dimensions.implausibly_large',
        severity: 'warning',
        area: 'specification',
        message: `${label} is ${value} ${unit}, which is unusually large for ${domain.label.toLowerCase()}.`,
        action: 'Check for a slipped decimal point or the wrong unit. If it is correct, ignore this.',
        subject: label,
      });
    } else if (mm < IMPLAUSIBLY_SMALL_MM) {
      findings.push({
        code: 'dimensions.implausibly_small',
        severity: 'warning',
        area: 'specification',
        message: `${label} is ${value} ${unit}, which is smaller than most fabricated parts.`,
        action: 'Check the unit — a value in metres that was meant as millimetres looks like this.',
        subject: label,
      });
    }
  }

  const width = dimensions.width;
  const height = dimensions.height;
  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    const ratio = Math.max(width / height, height / width);
    if (ratio > EXTREME_ASPECT_RATIO) {
      findings.push({
        code: 'dimensions.extreme_ratio',
        severity: 'note',
        area: 'specification',
        message: `The ${domain.noun.singular} is about ${Math.round(ratio)}:1. Long thin work is normal for ${longThinExample}, but check it is intended.`,
        action: null,
        subject: null,
      });
    }
  }

  const depth = dimensions.depth;
  if (
    typeof depth === 'number' &&
    typeof width === 'number' &&
    typeof height === 'number' &&
    depth > Math.min(width, height)
  ) {
    findings.push({
      code: 'dimensions.depth_exceeds_face',
      severity: 'note',
      area: 'specification',
      message: 'The depth is greater than the shorter face dimension.',
      action: 'Confirm the depth is not the length of something else.',
      subject: 'Depth',
    });
  }

  return findings;
}

/* -------------------------------------------------------------------------- */
/* Materials                                                                   */
/* -------------------------------------------------------------------------- */

export type MaterialCheckInput = {
  name: string;
  measurementModel: string;
  archived: boolean;
  standardLengthMm: number | null;
  sheetWidthMm: number | null;
  sheetHeightMm: number | null;
  unitPriceCents: number;
  /** Whether the project has stated how much of it is needed. */
  hasRequirement: boolean;
};

/**
 * Whether a material can actually be calculated with.
 *
 * These are blockers where the material genuinely cannot produce a number — a
 * linear material with no bar length has nothing to divide by — because the
 * alternative is a purchase count with no basis. A zero price is a warning
 * instead: buying something for nothing is unusual, but free offcuts and
 * client-supplied stock are real.
 */
export function checkMaterials(materials: MaterialCheckInput[]): Finding[] {
  const findings: Finding[] = [];

  for (const material of materials) {
    if (material.archived) {
      findings.push({
        code: 'material.archived',
        severity: 'warning',
        area: 'materials',
        message: `${material.name} has been archived in your library but is still on this project.`,
        action: 'Restore it, or replace it with the material you are actually buying.',
        subject: material.name,
      });
    }

    const missing =
      material.measurementModel === 'linear'
        ? material.standardLengthMm === null && 'a standard bar length'
        : material.measurementModel === 'sheet'
          ? (material.sheetWidthMm === null || material.sheetHeightMm === null) && 'sheet dimensions'
          : false;

    if (missing) {
      findings.push({
        code: 'material.missing_stock_size',
        severity: 'blocker',
        area: 'materials',
        message: `${material.name} has no ${missing}, so a purchase count cannot be worked out for it.`,
        action: `Add ${missing} to the material in your library.`,
        subject: material.name,
      });
    }

    if (material.unitPriceCents === 0) {
      findings.push({
        code: 'material.zero_price',
        severity: 'warning',
        area: 'materials',
        message: `${material.name} is priced at zero, so it will add nothing to the cost.`,
        action: 'Set its price, unless it really is free or client-supplied.',
        subject: material.name,
      });
    }

    if (!material.hasRequirement) {
      findings.push({
        code: 'material.no_requirement',
        severity: 'warning',
        area: 'materials',
        message: `No quantity has been stated for ${material.name}, so it is not in any calculation.`,
        action: 'Say how much the project needs, or remove it from the project.',
        subject: material.name,
      });
    }
  }

  return findings;
}

/* -------------------------------------------------------------------------- */
/* Derived state                                                               */
/* -------------------------------------------------------------------------- */

export type CalculationCheckInput = {
  name: string;
  calculated: boolean;
  staleReasons: string[];
  unsupportedReason: string | null;
  warnings: string[];
};

// Short phrases, with the shared clause said once at the end. Repeating "after
// it was calculated" per reason reads badly the moment two of them apply.
const STALE_REASON_TEXT: Record<string, string> = {
  spec_changed: 'the specification changed',
  material_changed: 'the material changed',
  requirement_changed: 'the stated quantity changed',
};

/**
 * Whether calculated lines still describe the project.
 *
 * Staleness is a blocker, not a warning. A superseded purchase count is not
 * merely uncertain — it is a number the system knows no longer follows from the
 * project, and putting it on a quote or a workshop sheet is the failure mode
 * this whole layer exists to prevent.
 */
export function checkCalculations(lines: CalculationCheckInput[]): Finding[] {
  const findings: Finding[] = [];

  for (const line of lines) {
    if (line.unsupportedReason) {
      findings.push({
        code: 'calculation.unsupported',
        severity: 'blocker',
        area: 'materials',
        message: `${line.name} could not be calculated: ${line.unsupportedReason}`,
        action: 'Fix the material, or remove the line from the project.',
        subject: line.name,
      });
      continue;
    }

    if (!line.calculated) {
      findings.push({
        code: 'calculation.missing',
        severity: 'blocker',
        area: 'materials',
        message: `${line.name} has never been calculated.`,
        action: 'Run the material calculation.',
        subject: line.name,
      });
      continue;
    }

    if (line.staleReasons.length > 0) {
      const reasons = line.staleReasons
        .map((reason) => STALE_REASON_TEXT[reason] ?? reason)
        .join(', and ');
      findings.push({
        code: 'calculation.stale',
        severity: 'blocker',
        area: 'materials',
        message: `The figures for ${line.name} are out of date: ${reasons} since they were calculated.`,
        action: 'Recalculate the materials.',
        subject: line.name,
      });
    }

    for (const warning of line.warnings) {
      findings.push({
        code: 'calculation.caveat',
        severity: 'warning',
        area: 'materials',
        message: warning,
        action: null,
        subject: line.name,
      });
    }
  }

  return findings;
}

export function checkCost(input: {
  exists: boolean;
  stale: boolean;
  blockedReason: string | null;
}): Finding[] {
  if (!input.exists) {
    return [
      {
        code: 'cost.missing',
        severity: 'blocker',
        area: 'cost',
        message: input.blockedReason ?? 'The project cost has not been calculated.',
        action: 'Calculate the cost.',
        subject: null,
      },
    ];
  }

  if (input.stale) {
    return [
      {
        code: 'cost.stale',
        severity: 'blocker',
        area: 'cost',
        message: 'The cost was worked out before the current material figures.',
        action: 'Recalculate the cost.',
        subject: null,
      },
    ];
  }

  return [];
}

export function checkDesign(input: { hasScene: boolean; diverged: boolean }): Finding[] {
  if (!input.hasScene) return [];
  if (!input.diverged) return [];

  return [
    {
      code: 'design.diverged',
      severity: 'warning',
      area: 'design',
      message: 'The canvas was built from an earlier specification than the current one.',
      action: 'Reseed the canvas, or confirm the design still matches what was agreed.',
      subject: null,
    },
  ];
}

export type CuttingCheckInput = {
  materialName: string;
  unplacedCount: number;
};

export function checkCutting(plans: CuttingCheckInput[]): Finding[] {
  return plans
    .filter((plan) => plan.unplacedCount > 0)
    .map((plan) => ({
      code: 'cutting.unplaced',
      severity: 'blocker' as const,
      area: 'cutting' as const,
      message: `${plan.unplacedCount} piece${plan.unplacedCount === 1 ? '' : 's'} in the ${plan.materialName} plan could not be placed and ${plan.unplacedCount === 1 ? 'is' : 'are'} not being cut.`,
      action: 'Use a larger stock size, split the piece, or remove it.',
      subject: plan.materialName,
    }));
}

/* -------------------------------------------------------------------------- */

export type FindingSummary = { blocker: number; warning: number; note: number };

export function summarise(findings: Finding[]): FindingSummary {
  return findings.reduce<FindingSummary>(
    (totals, finding) => ({ ...totals, [finding.severity]: totals[finding.severity] + 1 }),
    { blocker: 0, warning: 0, note: 0 }
  );
}

/** Blockers first, then warnings, then notes; stable within a severity. */
export function sortFindings(findings: Finding[]): Finding[] {
  const rank: Record<Severity, number> = { blocker: 0, warning: 1, note: 2 };
  return [...findings].sort((a, b) => rank[a.severity] - rank[b.severity]);
}
