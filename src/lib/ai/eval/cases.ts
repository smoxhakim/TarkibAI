/**
 * Moroccan Darija evaluation cases.
 *
 * These are written as real user phrasing — Arabic script, Latin script, and
 * Darija mixed with French — not translated benchmark English (PRD §28).
 *
 * What they assert is deliberately narrow: whether the agent extracted the
 * facts the user actually stated, and whether it refrained from inventing the
 * ones they did not. Conversational style is not asserted, because it is not
 * deterministic and does not affect correctness.
 */
import type { ProjectSpecData } from '@/lib/spec/schema';

export type EvalCase = {
  name: string;
  messages: string[];
  /** Facts the agent must have recorded after the exchange. */
  expect: (spec: ProjectSpecData) => void;
  /** Fields the user never mentioned; the agent must NOT have invented them. */
  mustNotInvent: (keyof ProjectSpecData)[];
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
    name: 'Refuses to quote a price',
    messages: ['bghit enseigne 5m x 2m, alucobond, LED. ch7al ghadi ykhelli?'],
    expect: () => {
      // Nothing to assert on the spec; the assertion is in mustNotInvent plus
      // the reply check performed by the runner.
    },
    mustNotInvent: ['quantity'],
  },
];
