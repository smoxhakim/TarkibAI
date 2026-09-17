/**
 * Which specialist instructions a turn carries.
 *
 * This is the test that makes "specialisation without separate agents"
 * meaningful rather than a claim. A module is selected from project state and
 * the caller's role, both of which are data, so the selection is assertable —
 * and the cost module in particular is asserted to be unreachable for the roles
 * the cost boundary exists for.
 */
import { describe, expect, it } from 'vitest';
import { grantsFor } from '../access';
import { snapshotFixture } from '../context/__fixtures__/snapshot';
import { AI_CAPABILITIES, renderCapabilities, selectCapabilities } from './capabilities';

const approved = { version: 1, status: 'approved' as const, complete: true, missingLabels: [] };

describe('capability selection', () => {
  it('always carries the specification and reference-image modules', () => {
    for (const role of ['owner', 'designer', 'sales', 'production', 'worker'] as const) {
      const active = selectCapabilities(snapshotFixture(), grantsFor(role));
      expect(active, role).toContain('specification');
      expect(active, role).toContain('references');
    }
  });

  it('leaves out design instructions for a role that cannot edit the design, on an empty canvas', () => {
    expect(selectCapabilities(snapshotFixture(), grantsFor('sales'))).not.toContain('design');
    expect(selectCapabilities(snapshotFixture(), grantsFor('designer'))).toContain('design');
  });

  it('still explains the canvas to a read-only role once there is something to explain', () => {
    const withCanvas = snapshotFixture({
      design: { objectCount: 3, diverged: false, seedBlockedReason: null },
    });
    expect(selectCapabilities(withCanvas, grantsFor('sales'))).toContain('design');
  });

  it('brings in materials once the specification is approved', () => {
    expect(selectCapabilities(snapshotFixture(), grantsFor('designer'))).not.toContain('materials');
    expect(
      selectCapabilities(snapshotFixture({ spec: approved }), grantsFor('designer'))
    ).toContain('materials');
  });

  it('brings in cutting only when a plan actually exists', () => {
    expect(selectCapabilities(snapshotFixture(), grantsFor('owner'))).not.toContain('cutting');
    expect(
      selectCapabilities(
        snapshotFixture({ cutting: { sheetPlanCount: 1, linearPlanCount: 0, unplacedCount: 0 } }),
        grantsFor('owner')
      )
    ).toContain('cutting');
  });

  describe('the cost module', () => {
    const everything = snapshotFixture({
      spec: approved,
      design: { objectCount: 4, diverged: false, seedBlockedReason: null },
      materials: { selectedCount: 3, calculatedCount: 3, staleCount: 0, lines: [], omittedLineCount: 0 },
      cutting: { sheetPlanCount: 2, linearPlanCount: 1, unplacedCount: 0 },
      documents: { productionCount: 1, issuedDrawingCount: 1, mockupCount: 0 },
    });

    it('is absent for every role without cost.view, however complete the project is', () => {
      for (const role of ['designer', 'production', 'worker'] as const) {
        expect(selectCapabilities(everything, grantsFor(role)), role).not.toContain('cost');
      }
    });

    it('is present for the roles that price the work', () => {
      for (const role of ['owner', 'admin', 'sales'] as const) {
        expect(selectCapabilities(everything, grantsFor(role)), role).toContain('cost');
      }
    });
  });

  it('holds production back until there is an approved specification or a package', () => {
    expect(selectCapabilities(snapshotFixture(), grantsFor('production'))).not.toContain('production');
    expect(selectCapabilities(snapshotFixture({ spec: approved }), grantsFor('production'))).toContain(
      'production'
    );
  });

  it('keeps the modules in workflow order regardless of how they were added', () => {
    const active = selectCapabilities(
      snapshotFixture({
        spec: approved,
        design: { objectCount: 2, diverged: false, seedBlockedReason: null },
        cutting: { sheetPlanCount: 1, linearPlanCount: 0, unplacedCount: 0 },
      }),
      grantsFor('owner')
    );
    const positions = active.map((capability) => AI_CAPABILITIES.indexOf(capability));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('capability rendering', () => {
  it('renders only the modules selected', () => {
    const text = renderCapabilities(['specification', 'references']);
    expect(text).toContain('## Specification');
    expect(text).toContain('## Reference images');
    expect(text).not.toContain('## Cost');
  });

  it('never tells a cost-blind turn anything about reading a cost', () => {
    const text = renderCapabilities(selectCapabilities(snapshotFixture(), grantsFor('worker')));
    expect(text).not.toContain('get_project_cost');
    expect(text).not.toMatch(/margin/i);
  });

  it('tells the design module to read before it changes, and to propose rather than apply', () => {
    const text = renderCapabilities(['design']);
    expect(text).toContain('get_canvas');
    expect(text).toContain('propose_design_change changes NOTHING');
  });

  it('forbids doing material arithmetic in the materials module', () => {
    const text = renderCapabilities(['materials']);
    expect(text).toContain('get_material_calculations');
    expect(text.replace(/\s+/g, ' ')).toMatch(/never divide an area by a sheet size yourself/i);
  });

  it('treats a size read from an image as an estimate, never as a recorded fact', () => {
    const text = renderCapabilities(['references']);
    expect(text).toContain('ESTIMATE');
    expect(text.replace(/\s+/g, ' ')).toMatch(
      /never write an estimated dimension into the specification/i
    );
  });
});
