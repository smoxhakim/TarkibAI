import type { DomainProfile } from './types';

/**
 * Signage and shopfront fabrication — the domain the product was built for.
 *
 * Every value here was hard-coded somewhere before T17. Extracting it changed
 * no behaviour for an existing project: the required fields, the plausibility
 * bounds and the agent's vocabulary are the ones that shipped.
 */
export const SIGNAGE: DomainProfile = {
  id: 'signage',
  label: 'Signage & shopfronts',
  description:
    'Illuminated and non-illuminated signs, facades, totems, lettering and shopfront work.',

  noun: { singular: 'sign', plural: 'signs' },

  projectTypeExamples: [
    'enseigne',
    'façade',
    'totem',
    'caisson lumineux',
    'lettres 3D',
    'panneau',
  ],

  // Lighting, mounting and environment are all real decisions on a shopfront:
  // an unlit sign is a choice, a sign has to be fixed to something, and outdoor
  // work changes the materials.
  requiredSpecFields: [
    'projectType',
    'dimensions.width',
    'dimensions.height',
    'dimensions.unit',
    'quantity',
    'materials',
    'lighting.type',
    'mounting.method',
    'site.environment',
  ],

  canvasObjectTypes: ['panel', 'frame', 'lettering', 'light', 'note'],

  dimensionBounds: {
    // A facade band of a few tens of metres is real; 100 m is past that but not
    // absurd, so it warns rather than refuses.
    implausiblyLargeMm: 100_000,
    implausiblySmallMm: 10,
    extremeAspectRatio: 50,
    longThinExample: 'fascia bands',
  },

  promptGuidance: `
This project is SIGNAGE or shopfront work: enseignes, façades, totems, caissons
lumineux, lettres 3D, panneaux.

Prioritise, in this order: what kind of sign it is, its dimensions, the
materials, whether and how it is lit, how it is fixed, whether it is indoor or
outdoor, and how many are needed.

Keep the French trade words the user uses — enseigne, façade, caisson, alucobond,
inox, plexi, lettres découpées — rather than translating them into awkward
equivalents.
`.trim(),

  mockupSubject: 'a fabricated commercial sign',
};
