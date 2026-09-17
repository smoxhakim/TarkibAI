/**
 * What the agent is TOLD about the project.
 *
 * Rendering is a pure function of the snapshot, so the one thing that decides
 * whether the agent can reason correctly — and whether it can see money it
 * should not — is assertable without a database or a model. These are
 * behavioural assertions about content, not about wording: they check that a
 * figure is present, absent, or named as missing, never that a sentence reads a
 * particular way.
 */
import { describe, expect, it } from 'vitest';
import { renderProjectState } from './project-context';
import { snapshotFixture } from './__fixtures__/snapshot';

describe('project state rendering', () => {
  it('names the project, its trade and its stage', () => {
    const text = renderProjectState(snapshotFixture({ stage: 'calculated' }));
    expect(text).toContain('Restaurant facade — Casablanca');
    expect(text).toContain('Signage');
    expect(text).toContain('calculated');
  });

  it('lists what the specification is still missing rather than implying it is done', () => {
    const text = renderProjectState(snapshotFixture());
    expect(text).toContain('Width');
    expect(text).toContain('Materials');
    expect(text).not.toContain('every required field answered');
  });

  it('says a calculated line has a purchase count, and an uncalculated one does not', () => {
    const text = renderProjectState(
      snapshotFixture({
        materials: {
          selectedCount: 2,
          calculatedCount: 1,
          staleCount: 0,
          lines: [
            {
              name: 'Alucobond 3mm noir',
              measurementModel: 'sheet',
              requiredQuantity: '18',
              unitsToPurchase: 4,
              calculated: true,
              stale: false,
              unsupportedReason: null,
            },
            {
              name: 'Tube inox 40x40',
              measurementModel: 'linear',
              requiredQuantity: '12',
              unitsToPurchase: null,
              calculated: false,
              stale: false,
              unsupportedReason: null,
            },
          ],
          omittedLineCount: 0,
        },
      })
    );

    expect(text).toContain('Alucobond 3mm noir: 4 to purchase (calculated)');
    // The uncalculated line must not acquire a number from anywhere.
    expect(text).toContain('Tube inox 40x40: requirement recorded, NOT calculated yet');
    expect(text).not.toMatch(/Tube inox 40x40:.*\d+ to purchase/);
  });

  it('marks a superseded calculation instead of presenting it as current', () => {
    const text = renderProjectState(
      snapshotFixture({
        materials: {
          selectedCount: 1,
          calculatedCount: 1,
          staleCount: 1,
          lines: [
            {
              name: 'Dibond',
              measurementModel: 'sheet',
              requiredQuantity: '9',
              unitsToPurchase: 2,
              calculated: true,
              stale: true,
              unsupportedReason: null,
            },
          ],
          omittedLineCount: 0,
        },
      })
    );
    expect(text).toContain('SUPERSEDED');
  });

  it('truncates a long material list honestly rather than silently', () => {
    const text = renderProjectState(
      snapshotFixture({
        materials: {
          selectedCount: 20,
          calculatedCount: 0,
          staleCount: 0,
          lines: [],
          omittedLineCount: 8,
        },
      })
    );
    expect(text).toContain('8 more line(s) not listed here');
  });

  it('reports unplaced cutting pieces as a problem', () => {
    const text = renderProjectState(
      snapshotFixture({ cutting: { sheetPlanCount: 1, linearPlanCount: 0, unplacedCount: 3 } })
    );
    expect(text).toContain('3 piece(s) could NOT be placed');
  });

  it('says the canvas no longer matches the approved specification when it has diverged', () => {
    const text = renderProjectState(
      snapshotFixture({ design: { objectCount: 4, diverged: true, seedBlockedReason: null } })
    );
    expect(text).toContain('OLDER SPECIFICATION');
  });

  describe('the cost boundary', () => {
    it('states that cost is not visible, and carries no figure, when the role cannot see it', () => {
      const text = renderProjectState(snapshotFixture({ cost: null }));
      expect(text).toContain('NOT VISIBLE TO THIS USER');
      expect(text).toContain('never estimate one');
      // No status leaks either: whether a cost exists is itself cost information.
      expect(text).not.toMatch(/Cost: (computed|not computed)/);
    });

    it('reports cost status, and nothing more, when the role can see it', () => {
      const text = renderProjectState(
        snapshotFixture({ cost: { computed: true, stale: false, blockedReason: null } })
      );
      expect(text).toContain('Cost: computed and current');
      expect(text).not.toContain('NOT VISIBLE');
      // The snapshot carries existence, never amounts — those come from the tool.
      expect(text).not.toMatch(/\d+\s*(MAD|DH|cents)/i);
    });

    it('says a cost is superseded rather than presenting it as the project cost', () => {
      const text = renderProjectState(
        snapshotFixture({ cost: { computed: true, stale: true, blockedReason: null } })
      );
      expect(text).toContain('SUPERSEDED');
    });

    it('gives the reason a cost could not be computed', () => {
      const text = renderProjectState(
        snapshotFixture({
          cost: {
            computed: false,
            stale: false,
            blockedReason: 'Calculate the project materials before costing it.',
          },
        })
      );
      expect(text).toContain('Calculate the project materials before costing it.');
    });
  });

  it('omits the quotes line entirely for a role that may not see quotations', () => {
    expect(renderProjectState(snapshotFixture({ quotes: null }))).not.toContain('Quotes:');
    expect(
      renderProjectState(snapshotFixture({ quotes: { count: 2, statuses: ['draft', 'issued'] } }))
    ).toContain('Quotes: 2');
  });

  it('names reference images without exposing a key or a URL', () => {
    const text = renderProjectState(
      snapshotFixture({
        references: { imageCount: 2, imageNames: ['shopfront.jpg', 'logo.png'], otherFileCount: 1 },
      })
    );
    expect(text).toContain('shopfront.jpg');
    expect(text).not.toMatch(/https?:\/\//);
  });

  it('tells the agent the figures are the application\'s, not its own', () => {
    const text = renderProjectState(snapshotFixture());
    expect(text).toContain('APPLICATION DATA');
    expect(text).toContain('Never compute, adjust, round or');
  });

  it('stays small enough to send on every turn', () => {
    const text = renderProjectState(
      snapshotFixture({
        materials: {
          selectedCount: 12,
          calculatedCount: 12,
          staleCount: 0,
          lines: Array.from({ length: 12 }, (_, index) => ({
            name: `Material ${index}`,
            measurementModel: 'sheet',
            requiredQuantity: '10',
            unitsToPurchase: 3,
            calculated: true,
            stale: false,
            unsupportedReason: null,
          })),
          omittedLineCount: 0,
        },
      })
    );
    // A full snapshot is roughly a page. The point of the summary/tool split is
    // that this stays bounded no matter how large the project gets.
    expect(text.length).toBeLessThan(4000);
  });
});
