import type { ProjectSnapshot } from '../project-context';

/**
 * A project snapshot for tests, with everything at its emptiest.
 *
 * Test-only: it lives under __fixtures__ and nothing in the application imports
 * it. Overriding one branch at a time is what makes the selection and rendering
 * assertions readable — each test says which single fact it is varying.
 */
export function snapshotFixture(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    title: 'Restaurant facade — Casablanca',
    stage: 'intake',
    domainLabel: 'Signage',
    spec: { version: 0, status: 'draft', complete: false, missingLabels: ['Width', 'Materials'] },
    design: { objectCount: 0, diverged: false, seedBlockedReason: null },
    materials: {
      selectedCount: 0,
      calculatedCount: 0,
      staleCount: 0,
      lines: [],
      omittedLineCount: 0,
    },
    cutting: { sheetPlanCount: 0, linearPlanCount: 0, unplacedCount: 0 },
    cost: null,
    quotes: null,
    documents: { productionCount: 0, issuedDrawingCount: 0, mockupCount: 0 },
    references: { imageCount: 0, imageNames: [], otherFileCount: 0 },
    ...overrides,
  };
}
