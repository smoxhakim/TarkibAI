import type { DomainProfile } from './types';

/**
 * Joinery, furniture and timber structures — menuiserie.
 *
 * The second domain, and the reason the framework is worth having rather than
 * being an abstraction with one implementation. It is a real domain, not a
 * placeholder: every engine downstream of the specification already supports it
 * unchanged, because measurement models, cutting, waste, cost and the documents
 * are trade-independent. A wardrobe carcass is sheet stock nested the same way
 * a sign face is, and a pergola rafter is a bar cut the same way a sign frame
 * is.
 *
 * What genuinely differs is above the engines: a fitted wardrobe has no lighting
 * decision, its plausible sizes are an order of magnitude smaller, and lettering
 * is not part of its vocabulary.
 */
export const JOINERY: DomainProfile = {
  id: 'joinery',
  label: 'Joinery & furniture',
  description:
    'Fitted furniture, cabinetry, doors, shelving, pergolas and other timber and panel work.',

  noun: { singular: 'piece', plural: 'pieces' },

  projectTypeExamples: [
    'placard',
    'cuisine',
    'dressing',
    'porte',
    'étagère',
    'pergola',
    'comptoir',
  ],

  // Lighting is deliberately absent. It is a real decision on a shopfront sign
  // and a rare extra on a wardrobe, and requiring it would force a user to
  // answer a question their trade does not ask before they can approve anything.
  requiredSpecFields: [
    'projectType',
    'dimensions.width',
    'dimensions.height',
    'dimensions.unit',
    'quantity',
    'materials',
    'mounting.method',
    'site.environment',
  ],

  // Lettering and lighting are not part of this vocabulary. The scene schema
  // still understands them — narrowing is about what is offered, not what can
  // be stored.
  canvasObjectTypes: ['panel', 'frame', 'note'],

  dimensionBounds: {
    // A long pergola or a run of fitted units reaches ten or twenty metres; a
    // hundred does not.
    implausiblyLargeMm: 20_000,
    implausiblySmallMm: 10,
    extremeAspectRatio: 30,
    longThinExample: 'shelving runs and pergola beams',
  },

  promptGuidance: `
This project is JOINERY or furniture work: placards, cuisines, dressings, portes,
étagères, pergolas, comptoirs.

Prioritise, in this order: what is being made, its dimensions, the materials and
panel thicknesses, how it is fixed or installed, whether it is indoor or outdoor,
and how many are needed. Ask about edge banding, hinges and finish when the user
raises them; do not treat them as blocking.

Do NOT ask about lighting unless the user brings it up — it is not part of most
joinery. Keep the French trade words the user uses — placard, dressing, MDF,
mélaminé, contreplaqué, chant — rather than translating them.
`.trim(),

  mockupSubject: 'a fabricated piece of joinery',
};
