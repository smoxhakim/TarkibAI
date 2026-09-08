import { describe, expect, it } from 'vitest';
import { SPEC_VERSION, type ProjectSpecData } from '@/lib/spec/schema';
import { JOINERY, SIGNAGE } from '@/lib/domains/registry';
import {
  checkCalculations,
  checkCost,
  checkCutting,
  checkDesign,
  checkDimensions,
  checkMaterials,
  sortFindings,
  summarise,
  type MaterialCheckInput,
} from './checks';

const spec = (patch: Partial<ProjectSpecData> = {}): ProjectSpecData => ({
  specVersion: SPEC_VERSION,
  ...patch,
});

const material = (patch: Partial<MaterialCheckInput> = {}): MaterialCheckInput => ({
  name: 'Aluminium tube',
  measurementModel: 'linear',
  archived: false,
  standardLengthMm: 6000,
  sheetWidthMm: null,
  sheetHeightMm: null,
  unitPriceCents: 20_000,
  hasRequirement: true,
  ...patch,
});

const codes = (findings: { code: string }[]) => findings.map((finding) => finding.code);

describe('checkDimensions', () => {
  it('accepts an ordinary sign without comment', () => {
    expect(checkDimensions(spec({ dimensions: { width: 8, height: 3, unit: 'm' } }), SIGNAGE)).toEqual([]);
  });

  it('warns about a value that looks like a slipped decimal', () => {
    const findings = checkDimensions(spec({ dimensions: { width: 800, height: 3, unit: 'm' } }), SIGNAGE);

    expect(codes(findings)).toContain('dimensions.implausibly_large');
    // A warning, never a blocker: the tool does not decide what someone may build.
    expect(findings.every((finding) => finding.severity !== 'blocker')).toBe(true);
  });

  it('warns about a value entered in the wrong unit', () => {
    expect(codes(checkDimensions(spec({ dimensions: { width: 0.008, height: 3, unit: 'm' } }), SIGNAGE))).toContain(
      'dimensions.implausibly_small'
    );
  });

  it('reads the same measurement differently depending on its unit', () => {
    // 8000 mm is an ordinary 8 m sign; 8000 m is not.
    expect(checkDimensions(spec({ dimensions: { width: 8000, height: 3000, unit: 'mm' } }), SIGNAGE)).toEqual([]);
    expect(codes(checkDimensions(spec({ dimensions: { width: 8000, height: 3000, unit: 'm' } }), SIGNAGE))).toContain(
      'dimensions.implausibly_large'
    );
  });

  it('says the numbers are ambiguous when no unit was recorded', () => {
    expect(codes(checkDimensions(spec({ dimensions: { width: 8, height: 3 } }), SIGNAGE))).toEqual([
      'dimensions.no_unit',
    ]);
  });

  it('says nothing when there are no dimensions to check', () => {
    expect(checkDimensions(spec(), SIGNAGE)).toEqual([]);
    expect(checkDimensions(spec({ dimensions: { unit: 'm' } }), SIGNAGE)).toEqual([]);
  });

  it('notes an extreme aspect ratio without objecting to it', () => {
    const findings = checkDimensions(spec({ dimensions: { width: 30, height: 0.4, unit: 'm' } }), SIGNAGE);

    const ratio = findings.find((finding) => finding.code === 'dimensions.extreme_ratio');
    expect(ratio?.severity).toBe('note');
    // Fascia bands really are this shape.
    expect(ratio?.message).toMatch(/fascia/i);
  });

  it('notes a depth greater than the shorter face dimension', () => {
    expect(
      codes(checkDimensions(spec({ dimensions: { width: 2, height: 0.3, depth: 0.5, unit: 'm' } }), SIGNAGE))
    ).toContain('dimensions.depth_exceeds_face');
  });
});

describe('checkMaterials', () => {
  it('passes a complete material', () => {
    expect(checkMaterials([material()])).toEqual([]);
  });

  it('blocks a linear material with no bar length', () => {
    const findings = checkMaterials([material({ standardLengthMm: null })]);

    expect(findings[0].severity).toBe('blocker');
    expect(findings[0].code).toBe('material.missing_stock_size');
    expect(findings[0].message).toMatch(/bar length/i);
  });

  it('blocks a sheet material missing either dimension', () => {
    const base = material({ measurementModel: 'sheet', standardLengthMm: null, sheetWidthMm: 2440 });
    expect(codes(checkMaterials([base]))).toContain('material.missing_stock_size');
    expect(
      checkMaterials([{ ...base, sheetHeightMm: 1220 }])
    ).toEqual([]);
  });

  it('does not require stock dimensions from models that have none', () => {
    for (const model of ['area', 'piece']) {
      expect(
        checkMaterials([material({ measurementModel: model, standardLengthMm: null })])
      ).toEqual([]);
    }
  });

  it('warns rather than blocks on a zero price, which is sometimes real', () => {
    const findings = checkMaterials([material({ unitPriceCents: 0 })]);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toMatch(/zero/i);
  });

  it('warns that an archived material is still on the project', () => {
    expect(codes(checkMaterials([material({ archived: true })]))).toContain('material.archived');
  });

  it('warns that a material has no stated quantity', () => {
    expect(codes(checkMaterials([material({ hasRequirement: false })]))).toContain(
      'material.no_requirement'
    );
  });
});

describe('checkCalculations', () => {
  const line = (patch: Partial<Parameters<typeof checkCalculations>[0][number]> = {}) => ({
    name: 'Aluminium tube',
    calculated: true,
    staleReasons: [] as string[],
    unsupportedReason: null,
    warnings: [] as string[],
    ...patch,
  });

  it('passes a current calculation', () => {
    expect(checkCalculations([line()])).toEqual([]);
  });

  it('blocks on a stale line and says which input moved', () => {
    const findings = checkCalculations([line({ staleReasons: ['spec_changed'] })]);

    // Stale is a blocker, not a warning: the system knows the figure no longer
    // follows from the project.
    expect(findings[0].severity).toBe('blocker');
    expect(findings[0].message).toMatch(/the specification changed since they were calculated/i);
  });

  it('reads several stale reasons together', () => {
    const findings = checkCalculations([
      line({ staleReasons: ['spec_changed', 'requirement_changed'] }),
    ]);
    // The shared clause is said once, not once per reason.
    expect(findings[0].message).toBe(
      'The figures for Aluminium tube are out of date: the specification changed, and the stated quantity changed since they were calculated.'
    );
  });

  it('blocks on an uncalculated line', () => {
    expect(checkCalculations([line({ calculated: false })])[0].code).toBe('calculation.missing');
  });

  it('reports an unsupported line once, with its own reason', () => {
    const findings = checkCalculations([
      line({ calculated: false, unsupportedReason: 'The material has no stock length.' }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('calculation.unsupported');
    expect(findings[0].message).toMatch(/no stock length/);
  });

  it('carries the engine\'s own caveats through as warnings', () => {
    const findings = checkCalculations([line({ warnings: ['This is a MINIMUM.'] })]);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toBe('This is a MINIMUM.');
  });
});

describe('checkCost', () => {
  it('blocks when no cost exists, using the reason given', () => {
    const findings = checkCost({ exists: false, stale: false, blockedReason: 'Calculate materials first.' });
    expect(findings[0].severity).toBe('blocker');
    expect(findings[0].message).toBe('Calculate materials first.');
  });

  it('blocks on a cost older than the material figures behind it', () => {
    expect(checkCost({ exists: true, stale: true, blockedReason: null })[0].code).toBe('cost.stale');
  });

  it('passes a current cost', () => {
    expect(checkCost({ exists: true, stale: false, blockedReason: null })).toEqual([]);
  });
});

describe('checkDesign and checkCutting', () => {
  it('says nothing about a project that has no canvas', () => {
    expect(checkDesign({ hasScene: false, diverged: true })).toEqual([]);
  });

  it('warns when the canvas is behind the specification', () => {
    expect(checkDesign({ hasScene: true, diverged: true })[0].severity).toBe('warning');
  });

  it('blocks when pieces are not being cut', () => {
    const findings = checkCutting([{ materialName: 'Dibond', unplacedCount: 2 }]);
    expect(findings[0].severity).toBe('blocker');
    expect(findings[0].message).toMatch(/2 pieces .* could not be placed/);
  });

  it('says nothing when every piece was placed', () => {
    expect(checkCutting([{ materialName: 'Dibond', unplacedCount: 0 }])).toEqual([]);
  });
});

describe('summarise and sortFindings', () => {
  const findings = [
    { code: 'a', severity: 'note' as const, area: 'cost' as const, message: '', action: null, subject: null },
    { code: 'b', severity: 'blocker' as const, area: 'cost' as const, message: '', action: null, subject: null },
    { code: 'c', severity: 'warning' as const, area: 'cost' as const, message: '', action: null, subject: null },
    { code: 'd', severity: 'blocker' as const, area: 'cost' as const, message: '', action: null, subject: null },
  ];

  it('counts by severity', () => {
    expect(summarise(findings)).toEqual({ blocker: 2, warning: 1, note: 1 });
  });

  it('counts nothing as zero rather than as absent', () => {
    expect(summarise([])).toEqual({ blocker: 0, warning: 0, note: 0 });
  });

  it('puts what stops the job first, and is stable within a severity', () => {
    expect(codes(sortFindings(findings))).toEqual(['b', 'd', 'c', 'a']);
  });
});
