import type { SpecFieldKey } from '@/lib/spec/completeness';
import type { ObjectType } from '@/lib/canvas/schema';

/**
 * What a domain profile is, and — more importantly — what it is not.
 *
 * A profile carries the things that genuinely differ between fabrication
 * trades: which specification fields must be answered before a project can be
 * approved, what the agent should call the thing being made, which canvas
 * objects are worth offering, and what counts as an implausible dimension.
 *
 * It does NOT carry calculation. Material requirements, purchase counts,
 * cutting, waste, cost and tax are the same arithmetic in every trade — a
 * 6 m bar divides the same way whether it becomes a sign frame or a pergola
 * rafter. Those engines stay platform-level, and a profile that could change
 * them would be a place for a trade to acquire its own quietly different
 * arithmetic (PRD 24: industry rules isolated FROM reusable components, not
 * reaching into them).
 *
 * Anything a profile cannot express is a signal that the seam is in the wrong
 * place, not an invitation to widen this type until it can express everything.
 */
export type DomainProfile = {
  /** Stable identifier stored on the project. Never renamed. */
  id: string;
  label: string;
  /** One line shown where a domain is chosen. */
  description: string;

  /**
   * What the agent calls the thing being made, singular and plural.
   * "sign" and "signs"; "piece" and "pieces".
   */
  noun: { singular: string; plural: string };

  /** Examples offered to the user and to the model. Never a closed list. */
  projectTypeExamples: string[];

  /**
   * Specification fields required before approval.
   *
   * The reason this is per-domain: lighting is a real decision on a shopfront
   * sign and meaningless on a set of kitchen units, and demanding it would
   * force a user to answer a question their trade does not ask.
   */
  requiredSpecFields: readonly SpecFieldKey[];

  /**
   * Canvas object types offered for this domain.
   *
   * A subset of the platform vocabulary, never an extension of it. The scene
   * schema keeps the full union so a stored scene stays readable if a project's
   * domain ever changes — narrowing what is offered is a UI and prompt
   * decision, not a data one.
   */
  canvasObjectTypes: readonly ObjectType[];

  /**
   * Dimension plausibility, in millimetres.
   *
   * Per-domain because the same number means different things: a 12 m run is
   * ordinary signage and a very large piece of joinery. These only ever produce
   * warnings — see the note on severity in the validation layer.
   */
  dimensionBounds: {
    implausiblyLargeMm: number;
    implausiblySmallMm: number;
    extremeAspectRatio: number;
    /** Named in the "unusually long and thin" note, e.g. "fascia bands". */
    longThinExample: string;
  };

  /** Domain paragraph injected into the agent's system prompt. */
  promptGuidance: string;

  /** How a mockup describes its subject when the spec says little. */
  mockupSubject: string;
};
