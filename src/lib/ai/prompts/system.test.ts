/**
 * The assembled system prompt.
 *
 * The regression that prompted most of these: until T21 the prompt told users
 * that mockups, drawings, prices and PDFs were "not available yet". That was
 * true when it was written in T1 and false from T4 onwards, so the agent was
 * actively misinforming people about their own product. A prompt is code that
 * nobody typechecks, which is exactly why the claims that matter are asserted
 * here.
 *
 * Assertions are about content and boundaries, never about phrasing.
 */
import { describe, expect, it } from 'vitest';
import { SIGNAGE, JOINERY } from '@/lib/domains/registry';
import { emptySpec } from '@/lib/spec/schema';
import { grantsFor } from '../access';
import { snapshotFixture } from '../context/__fixtures__/snapshot';
import { selectCapabilities } from './capabilities';
import { buildSpecStateMessage, buildSystemPrompt } from './system';

const flat = (text: string) => text.replace(/\s+/g, ' ');

function promptFor(role: Parameters<typeof grantsFor>[0], snapshot = snapshotFixture()) {
  const grants = grantsFor(role);
  return buildSystemPrompt({
    domain: SIGNAGE,
    capabilities: selectCapabilities(snapshot, grants),
    grants,
  });
}

describe('the assembled system prompt', () => {
  it('no longer claims the product cannot produce mockups, drawings, prices or PDFs', () => {
    const text = flat(promptFor('owner'));
    expect(text).not.toMatch(/not available yet/i);
    expect(text).not.toMatch(/cannot do yet/i);
    expect(text).not.toMatch(/the specification is the current step/i);
  });

  it('keeps the four kinds of statement apart', () => {
    const text = promptFor('owner');
    expect(text).toContain('WHAT THE USER STATED');
    expect(text).toContain('WHAT THE APPLICATION COMPUTED');
    expect(text).toContain('WHAT YOU ARE INFERRING');
    expect(text).toContain('WHAT NOBODY KNOWS YET');
  });

  it('forbids inventing a figure and forbids doing the arithmetic', () => {
    const text = flat(promptFor('owner'));
    expect(text).toMatch(/NEVER invent a dimension, quantity, material, stock size, price/);
    expect(text).toMatch(/NEVER do the arithmetic that belongs to an engine/);
    expect(text).toMatch(/exactly two exceptions/);
  });

  describe('approval', () => {
    it('states that approval is the user\'s and that "wakha" is not consent', () => {
      const text = flat(promptFor('owner'));
      expect(text).toMatch(/Approval is a button in the interface/);
      expect(text).toMatch(/"wakha" or "ok" from the user is not approval/);
    });

    it('never suggests the agent can approve anything', () => {
      const text = flat(promptFor('owner'));
      expect(text).not.toMatch(/you (can|may) approve/i);
    });
  });

  describe('the Darija module', () => {
    const text = promptFor('owner');

    it('covers every script and mixture the architecture requires', () => {
      expect(text).toContain('Arabic script');
      expect(text).toContain('Latin script');
      expect(text).toContain('Darija with French');
      expect(text).toContain('Darija with English');
    });

    it('explains the Arabic chat alphabet, so "3ard" is not read as a number', () => {
      expect(text).toContain('3 = ع');
      expect(flat(text)).toMatch(/A digit used this way is a LETTER, not a number/);
    });

    it('accepts Arabic-Indic digits', () => {
      expect(text).toContain('٠١٢٣٤٥٦٧٨٩');
    });

    it('separates "santim" the centimetre from "santim" the centime', () => {
      const compact = flat(text);
      expect(compact).toMatch(/In a LENGTH context it is a centimetre/);
      expect(compact).toMatch(/In a PRICE context it is a CENTIME of a dirham/);
      expect(compact).toMatch(/Never let a price quoted in santim become a length/);
    });

    it('allows unit conversion and nothing else', () => {
      expect(flat(text)).toMatch(
        /Converting between mm, cm and m is the ONLY arithmetic you may do yourself/
      );
    });

    it('spells out the ma…ch negation, which reverses meaning if missed', () => {
      expect(text).toContain('ma3andich');
      expect(flat(text)).toMatch(/NEGATES it/);
    });

    it('forbids assuming a unit for a bare number', () => {
      expect(flat(text)).toMatch(/Never assume metres or centimetres/);
    });

    it('maps every dimension word onto a field the schema actually has', () => {
      const compact = flat(text);
      // "الطول" has no home of its own: the specification holds width, height
      // and depth. Left unmapped, the agent silently drops the number.
      expect(compact).toMatch(/holds exactly THREE dimensions — width, height, depth/);
      expect(compact).toMatch(/the piece's LONG dimension/);
      expect(compact).toMatch(/NEVER drop a dimension the user stated/);
    });

    it('tells the agent to reply in the script the user wrote in', () => {
      expect(flat(text)).toMatch(/Reply in the script the user wrote in/);
    });
  });

  describe('what the role allows', () => {
    it('tells an editor it can record and propose', () => {
      const text = promptFor('owner');
      expect(text).toContain('You can record what they tell you into the specification.');
      expect(text).toContain('You can propose design changes');
    });

    it('tells a worker it can do neither, and cannot discuss money', () => {
      const text = flat(promptFor('worker'));
      expect(text).toMatch(/CANNOT record anything into the specification/);
      expect(text).toMatch(/CANNOT propose design changes/);
      expect(text).toMatch(/CANNOT discuss internal cost, margin, purchase prices or savings/);
    });

    it('tells a designer it may edit design but not discuss money', () => {
      const text = flat(promptFor('designer'));
      expect(text).toContain('You can propose design changes');
      expect(text).toMatch(/CANNOT discuss internal cost/);
    });

    it('says nothing restrictive about money to a role that may see it', () => {
      const text = flat(promptFor('sales'));
      expect(text).not.toMatch(/CANNOT discuss internal cost/);
    });
  });

  it('carries the project\'s trade, not every trade', () => {
    const signage = buildSystemPrompt({
      domain: SIGNAGE,
      capabilities: ['specification'],
      grants: grantsFor('owner'),
    });
    const joinery = buildSystemPrompt({
      domain: JOINERY,
      capabilities: ['specification'],
      grants: grantsFor('owner'),
    });

    expect(signage).toContain(SIGNAGE.noun.singular);
    expect(joinery).toContain(JOINERY.noun.singular);
    expect(joinery).not.toContain(SIGNAGE.promptGuidance);
  });

  it('grows with the project instead of sending every module every time', () => {
    const empty = promptFor('worker');
    const busy = promptFor(
      'owner',
      snapshotFixture({
        spec: { version: 2, status: 'approved', complete: true, missingLabels: [] },
        design: { objectCount: 5, diverged: false, seedBlockedReason: null },
        cutting: { sheetPlanCount: 2, linearPlanCount: 1, unplacedCount: 0 },
      })
    );
    expect(busy.length).toBeGreaterThan(empty.length);
  });
});

describe('the specification state message', () => {
  it('names each missing field and asks for only a few at a time', () => {
    const text = buildSpecStateMessage(emptySpec(), ['dimensions.width', 'materials']);
    expect(text).toContain('Width');
    expect(text).toContain('Materials');
    expect(text).toContain('at most two or three');
  });

  it('invites review rather than declaring approval when nothing is missing', () => {
    const text = buildSpecStateMessage(emptySpec(), []);
    expect(text).toContain('Do not claim it is approved.');
    expect(text).toMatch(/invite the user to review and approve/i);
  });

  it('presents the specification as the record of what the USER stated', () => {
    expect(buildSpecStateMessage(emptySpec(), [])).toContain('what the USER STATED');
  });
});
