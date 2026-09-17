/**
 * Moroccan Darija evaluation cases.
 *
 * These are written as real user phrasing — Arabic script, Latin script, and
 * Darija mixed with French or English — not translated benchmark English
 * (PRD §28).
 *
 * What they assert is deliberately narrow: whether the agent extracted the
 * facts the user actually stated, and whether it refrained from inventing the
 * ones they did not. Conversational style is not asserted, because it is not
 * deterministic and does not affect correctness. Where a reply itself must not
 * contain something — a price, a resolved ambiguity — the case says so as a
 * pattern rather than as an expected sentence.
 */
import type { ProjectSpecData } from '@/lib/spec/schema';

export type EvalCase = {
  name: string;
  messages: string[];
  /** Facts the agent must have recorded after the exchange. */
  expect: (spec: ProjectSpecData) => void;
  /** Fields the user never mentioned; the agent must NOT have invented them. */
  mustNotInvent: (keyof ProjectSpecData)[];
  /** A pattern the final reply must not match, with why it would be wrong. */
  replyMustNotMatch?: { pattern: RegExp; because: string };
};

export const EVAL_CASES: EvalCase[] = [
  {
    name: 'Latin-script Darija with dimensions and material',
    messages: ['bghit enseigne dyal restaurant, 8 metres l3ard w 3 metres l3lo, alucobond noir'],
    expect: (spec) => {
      if (spec.dimensions?.width !== 8) throw new Error(`width: expected 8, got ${spec.dimensions?.width}`);
      if (spec.dimensions?.height !== 3) throw new Error(`height: expected 3, got ${spec.dimensions?.height}`);
      if (spec.dimensions?.unit !== 'm') throw new Error(`unit: expected m, got ${spec.dimensions?.unit}`);
      const materials = (spec.materials ?? []).map((m) => m.name.toLowerCase()).join(' ');
      if (!materials.includes('alucobond')) throw new Error(`materials missing alucobond: ${materials}`);
    },
    mustNotInvent: ['quantity', 'mounting', 'lighting'],
  },
  {
    name: 'Arabic-script Darija',
    messages: ['بغيت لافتة ديال المطعم، الطول 6 متر والعرض 2 متر'],
    expect: (spec) => {
      const values = [spec.dimensions?.width, spec.dimensions?.height];
      if (!values.includes(6) || !values.includes(2)) {
        throw new Error(`expected 6 and 2 among dimensions, got ${JSON.stringify(spec.dimensions)}`);
      }
      if (spec.dimensions?.unit !== 'm') throw new Error(`unit: expected m, got ${spec.dimensions?.unit}`);
    },
    mustNotInvent: ['materials', 'lighting', 'quantity'],
  },
  {
    name: 'Arabic-Indic numerals carry their value',
    messages: ['بغيت كيسون لوميني، العرض ٤ متر والعلو ١ متر'],
    expect: (spec) => {
      const values = [spec.dimensions?.width, spec.dimensions?.height];
      if (!values.includes(4) || !values.includes(1)) {
        throw new Error(`٤ and ١ were not read as 4 and 1: ${JSON.stringify(spec.dimensions)}`);
      }
    },
    mustNotInvent: ['materials', 'quantity'],
  },
  {
    name: 'Darija/French code-switching',
    messages: ['dir lia façade b alucobond noir, w bghit des lettres 3D avec éclairage LED'],
    expect: (spec) => {
      const materials = (spec.materials ?? []).map((m) => m.name.toLowerCase()).join(' ');
      if (!materials.includes('alucobond')) throw new Error(`materials missing alucobond: ${materials}`);
      if (spec.lighting?.type !== 'led') throw new Error(`lighting: expected led, got ${spec.lighting?.type}`);
    },
    mustNotInvent: ['dimensions', 'quantity'],
  },
  {
    name: 'Darija/English code-switching',
    messages: ['bghit a backlit sign, width 5 metres, height 2 metres, outdoor, brushed inox finish'],
    expect: (spec) => {
      if (spec.dimensions?.width !== 5) throw new Error(`width: expected 5, got ${spec.dimensions?.width}`);
      if (spec.dimensions?.height !== 2) throw new Error(`height: expected 2, got ${spec.dimensions?.height}`);
      if (spec.site?.environment !== 'outdoor') {
        throw new Error(`site: expected outdoor, got ${spec.site?.environment}`);
      }
    },
    mustNotInvent: ['quantity'],
  },
  {
    name: 'Number words instead of digits',
    messages: ['bghit juj enseignes, kola wa7da tlata metro l3ard w metro l3lo'],
    expect: (spec) => {
      if (spec.quantity !== 2) throw new Error(`quantity: "juj" should be 2, got ${spec.quantity}`);
      if (spec.dimensions?.width !== 3) {
        throw new Error(`width: "tlata metro" should be 3 m, got ${spec.dimensions?.width}`);
      }
    },
    mustNotInvent: ['materials', 'lighting'],
  },
  {
    name: 'Dimension given with no unit must not be assumed',
    messages: ['bghit enseigne, l3ard dyalha 250'],
    expect: (spec) => {
      // The agent may record nothing here, but it must NOT guess a unit.
      if (spec.dimensions?.unit != null) {
        throw new Error(`invented a unit (${spec.dimensions.unit}) for an unlabelled number`);
      }
    },
    mustNotInvent: ['materials', 'lighting', 'quantity'],
  },
  {
    name: 'Mixed units are normalised, not taken at face value',
    messages: ['bghit enseigne, l3ard 6 metres, l3lo 80 santim'],
    expect: (spec) => {
      // The specification holds ONE unit, so the agent has to convert. What it
      // must never do is carry 80 across unchanged: a "unit: m, height: 80"
      // record is an eighty-metre sign, built from the words "80 santim".
      const { width, height, unit } = spec.dimensions ?? {};
      if (!unit || width == null || height == null) {
        throw new Error(`expected both dimensions in one unit, got ${JSON.stringify(spec.dimensions)}`);
      }
      const perUnit = { mm: 1, cm: 10, m: 1000 }[unit] ?? 0;
      const widthMm = width * perUnit;
      const heightMm = height * perUnit;
      if (widthMm !== 6000) throw new Error(`width should be 6 m, got ${widthMm} mm`);
      if (heightMm !== 800) throw new Error(`"80 santim" should be 800 mm, got ${heightMm} mm`);
    },
    mustNotInvent: ['materials', 'quantity'],
  },
  {
    name: 'Negation: what the user does NOT have is not a project material',
    messages: [
      'bghit enseigne 4 metres l3ard, 1 metre l3lo. had lprofile inox ma3andich daba.',
    ],
    expect: (spec) => {
      const materials = (spec.materials ?? []).map((m) => m.name.toLowerCase()).join(' ');
      if (materials.includes('inox')) {
        throw new Error(`recorded inox as a material although the user said they do NOT have it: ${materials}`);
      }
    },
    mustNotInvent: ['quantity', 'lighting'],
  },
  {
    name: 'Correction across turns replaces the earlier value',
    messages: [
      'bghit enseigne 6 metres l3ard, 2 metres l3lo, quantité wahda',
      'smeh liya, machi 6 metres, howa 8 metres l3ard',
    ],
    expect: (spec) => {
      if (spec.dimensions?.width !== 8) {
        throw new Error(`correction not applied: width is ${spec.dimensions?.width}, expected 8`);
      }
      if (spec.dimensions?.height !== 2) {
        throw new Error(`correction clobbered height: ${spec.dimensions?.height}, expected 2`);
      }
    },
    mustNotInvent: ['materials'],
  },
  {
    name: 'A relative change is applied to the recorded value, not guessed',
    messages: ['bghit totem 2 metres l3ard, 4 metres l3lo', 'zid metro f l3ard'],
    expect: (spec) => {
      if (spec.dimensions?.width !== 3) {
        throw new Error(`"zid metro" on a 2 m width should give 3, got ${spec.dimensions?.width}`);
      }
      if (spec.dimensions?.height !== 4) {
        throw new Error(`height should be untouched at 4, got ${spec.dimensions?.height}`);
      }
    },
    mustNotInvent: ['materials'],
  },
  {
    name: 'Refuses to quote a price',
    messages: ['bghit enseigne 5m x 2m, alucobond, LED. ch7al ghadi ykhelli?'],
    expect: () => {
      // Nothing to assert on the spec; the assertion is in mustNotInvent plus
      // the reply check below.
    },
    mustNotInvent: ['quantity'],
    replyMustNotMatch: {
      pattern: /\b\d[\d\s.,]*\s*(dh|dhs|mad|درهم|dirham|€|\$)/i,
      because: 'no cost has been computed for this project, so any figure would be fabricated',
    },
  },
  {
    name: 'Does not invent a material quantity before anything is calculated',
    messages: ['bghit enseigne 6m x 1m f alucobond. ch7al mn plaque ghadi tssali lia?'],
    expect: () => {
      // The material engine has not run and no material is selected. A sheet
      // count here would be arithmetic the agent is not allowed to do.
    },
    mustNotInvent: ['quantity'],
    replyMustNotMatch: {
      pattern: /\b\d+\s*(plaque|plaques|sheet|sheets|لوح)\b/i,
      because: 'no material calculation exists, so a sheet count would be invented',
    },
  },
];
