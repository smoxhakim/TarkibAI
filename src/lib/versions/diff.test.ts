import { describe, expect, it } from 'vitest';
import type { VersionSnapshot } from './snapshot';
import { diffMaps, diffSnapshots, flattenSpec, humanisePath } from './diff';

const snapshot = (patch: Partial<VersionSnapshot> = {}): VersionSnapshot => ({
  spec: {},
  canvas: null,
  materials: null,
  cost: null,
  references: null,
  ...patch,
});

describe('humanisePath', () => {
  it('reads a dotted path as a person would', () => {
    expect(humanisePath('dimensions.width')).toBe('Dimensions › Width');
    expect(humanisePath('finishNotes')).toBe('Finish Notes');
    expect(humanisePath('site.heightFromGroundM')).toBe('Site › Height From Ground M');
  });

  it('keeps a named array key intact', () => {
    expect(humanisePath('components[Acrylic face].quantity')).toBe(
      'Components [Acrylic face] › Quantity'
    );
  });
});

describe('flattenSpec', () => {
  it('flattens nested objects by path', () => {
    expect([...flattenSpec({ dimensions: { width: 8, unit: 'm' } })]).toEqual([
      ['dimensions.width', '8'],
      ['dimensions.unit', 'm'],
    ]);
  });

  it("does not report an entry's own name as one of its fields", () => {
    // The name is already the key in the path; emitting it again makes every
    // added entry say "Name: added — Downlight bar" under a heading that
    // already says so.
    const before = flattenSpec({ components: [{ name: 'Tray', quantity: 1 }] });
    const after = flattenSpec({
      components: [{ name: 'Tray', quantity: 1 }, { name: 'Downlight bar', quantity: 2 }],
    });

    expect(diffMaps(before, after)).toEqual([
      {
        path: 'components[Downlight bar].quantity',
        label: 'Components [Downlight bar] › Quantity',
        from: null,
        to: '2',
        kind: 'added',
      },
    ]);
  });

  it('still reports an entry that carries nothing but a name', () => {
    const before = flattenSpec({ materials: [] });
    const after = flattenSpec({ materials: [{ name: 'tube' }] });

    expect(diffMaps(before, after).map((change) => change.path)).toEqual(['materials[tube]']);
  });

  it('keys an array of named objects by name, not by index', () => {
    // Reordering two components must not read as four changes.
    const a = flattenSpec({ components: [{ name: 'Tray', quantity: 1 }, { name: 'Face', quantity: 2 }] });
    const b = flattenSpec({ components: [{ name: 'Face', quantity: 2 }, { name: 'Tray', quantity: 1 }] });

    expect(diffMaps(a, b)).toEqual([]);
  });

  it('keeps an array of scalars as one fact', () => {
    expect(flattenSpec({ lettering: { colors: ['red', 'white'] } }).get('lettering.colors')).toBe(
      'red, white'
    );
  });

  it('omits absent values rather than recording them as empty', () => {
    const flat = flattenSpec({ projectType: 'enseigne', industry: null, notes: '' });
    expect([...flat.keys()]).toEqual(['projectType']);
  });

  it('ignores the schema version, which no user changed', () => {
    expect(flattenSpec({ specVersion: 1, projectType: 'totem' }).has('specVersion')).toBe(false);
  });
});

describe('diffMaps', () => {
  it('classifies additions, removals and changes', () => {
    const before = new Map([['a', '1'], ['b', '2']]);
    const after = new Map([['b', '3'], ['c', '4']]);

    expect(diffMaps(before, after)).toEqual([
      { path: 'a', label: 'A', from: '1', to: null, kind: 'removed' },
      { path: 'b', label: 'B', from: '2', to: '3', kind: 'changed' },
      { path: 'c', label: 'C', from: null, to: '4', kind: 'added' },
    ]);
  });

  it('is ordered by path, so the same comparison always reads the same way', () => {
    const before = new Map([['z', '1'], ['a', '1']]);
    const after = new Map([['z', '2'], ['a', '2']]);

    expect(diffMaps(before, after).map((change) => change.path)).toEqual(['a', 'z']);
  });
});

describe('diffSnapshots', () => {
  it('reports a specification change', () => {
    const diff = diffSnapshots(
      snapshot({ spec: { dimensions: { width: 8, unit: 'm' } } }),
      snapshot({ spec: { dimensions: { width: 10, unit: 'm' } } })
    );

    expect(diff.identical).toBe(false);
    expect(diff.spec).toEqual([
      { path: 'dimensions.width', label: 'Dimensions › Width', from: '8', to: '10', kind: 'changed' },
    ]);
  });

  it('reports two identical snapshots as identical', () => {
    const spec = { projectType: 'enseigne', dimensions: { width: 8, unit: 'm' } };
    expect(diffSnapshots(snapshot({ spec }), snapshot({ spec })).identical).toBe(true);
  });

  it('says a section cannot be compared rather than reporting a deletion', () => {
    // An older version written before canvas snapshots existed has none. Reading
    // that as "every object was removed" would be a lie about what happened.
    const withCanvas = snapshot({
      canvas: [{ id: 'a', type: 'panel', label: 'Face', x: 0, y: 0, widthMm: 100, heightMm: 50, depthMm: null }],
    });

    const diff = diffSnapshots(snapshot(), withCanvas);
    expect(diff.canvas.entries).toEqual([]);
    expect(diff.canvas.unavailableReason).toMatch(/cannot be compared/i);
  });

  it('reports canvas objects added, removed and moved', () => {
    const object = (id: string, x: number, label: string) => ({
      id, type: 'panel', label, x, y: 0, widthMm: 100, heightMm: 50, depthMm: null,
    });

    const diff = diffSnapshots(
      snapshot({ canvas: [object('a', 0, 'Face'), object('b', 0, 'Old')] }),
      snapshot({ canvas: [object('a', 250, 'Face'), object('c', 0, 'New')] })
    );

    expect(diff.canvas.entries).toEqual([
      { name: 'Face', kind: 'changed', changes: [
        { path: 'x', label: 'X', from: '0 mm', to: '250 mm', kind: 'changed' },
      ] },
      { name: 'Old', kind: 'removed', changes: [] },
      { name: 'New', kind: 'added', changes: [] },
    ]);
  });

  it('reports a material whose purchase count moved', () => {
    const line = (units: number | null) => ({
      materialId: 'm1', name: 'Aluminium tube', role: 'Frame',
      requiredQuantity: '25', unitsToPurchase: units,
      totalPurchasedQuantity: null, wastePercent: null, unsupportedReason: null,
    });

    const diff = diffSnapshots(
      snapshot({ materials: [line(5)] }),
      snapshot({ materials: [line(6)] })
    );

    expect(diff.materials.entries).toEqual([
      { name: 'Aluminium tube', kind: 'changed', changes: [
        { path: 'unitsToPurchase', label: 'Units To Purchase', from: '5', to: '6', kind: 'changed' },
      ] },
    ]);
  });

  it('compares cost figures but not the moment they were computed', () => {
    const cost = (materials: number, computedAt: string) => ({
      materialsCostCents: materials, laborCostCents: 0, transportCostCents: 0,
      installCostCents: 0, otherCostCents: 0, internalTotalCents: materials,
      marginCents: 0, clientSubtotalCents: materials, taxCents: 0,
      clientTotalCents: materials, computedAt, currency: 'MAD',
    });

    // Recomputing the same inputs later is not a change to the cost.
    const rerun = diffSnapshots(
      snapshot({ cost: cost(100_000, '2026-09-01T00:00:00.000Z') }),
      snapshot({ cost: cost(100_000, '2026-09-08T00:00:00.000Z') })
    );
    expect(rerun.cost).toEqual([]);
    expect(rerun.identical).toBe(true);

    const moved = diffSnapshots(
      snapshot({ cost: cost(100_000, '2026-09-01T00:00:00.000Z') }),
      snapshot({ cost: cost(120_000, '2026-09-01T00:00:00.000Z') })
    );
    expect(moved.cost.map((change) => change.path)).toEqual([
      'clientSubtotal',
      'clientTotal',
      'internalTotal',
      'materials',
    ]);
  });

  it('shows cost as money, never as raw minor units', () => {
    // "266000" reads as two hundred and sixty-six thousand. On the one section
    // whose numbers are money, that is an order-of-magnitude misreading.
    const cost = (materials: number, currency: string | null) => ({
      materialsCostCents: materials, laborCostCents: 0, transportCostCents: 0,
      installCostCents: 0, otherCostCents: 0, internalTotalCents: materials,
      marginCents: 0, clientSubtotalCents: materials, taxCents: 0,
      clientTotalCents: materials, computedAt: '', currency,
    });

    const diff = diffSnapshots(
      snapshot({ cost: cost(266_000, 'MAD') }),
      snapshot({ cost: cost(305_200, 'MAD') })
    );
    const materials = diff.cost.find((change) => change.path === 'materials')!;
    expect(materials.from).toMatch(/^2.660\.00 MAD$/);
    expect(materials.to).toMatch(/^3.052\.00 MAD$/);

    // An older snapshot has no currency; the amount is still readable.
    const older = diffSnapshots(
      snapshot({ cost: cost(266_000, null) }),
      snapshot({ cost: cost(305_200, null) })
    );
    expect(older.cost.find((change) => change.path === 'materials')!.from).toMatch(/^2.660\.00$/);
  });

  it('says the cost cannot be compared when one side never had one', () => {
    const diff = diffSnapshots(
      snapshot(),
      snapshot({ cost: {
        materialsCostCents: 1, laborCostCents: 0, transportCostCents: 0, installCostCents: 0,
        otherCostCents: 0, internalTotalCents: 1, marginCents: 0, clientSubtotalCents: 1,
        taxCents: 0, clientTotalCents: 1, computedAt: '', currency: 'MAD',
      } })
    );

    expect(diff.cost).toEqual([]);
    expect(diff.costUnavailableReason).toMatch(/cannot be compared/i);
  });

  it('reports documents that appeared between two versions', () => {
    const references = (quotes: string[], packages: number[]) => ({
      specVersion: 2, specApproved: true, drawingVersions: [1],
      quoteNumbers: quotes, productionVersions: packages,
    });

    const diff = diffSnapshots(
      snapshot({ references: references([], []) }),
      snapshot({ references: references(['Q-2026-0001'], [1]) })
    );

    expect(diff.references).toEqual([
      { path: 'productionVersions', label: 'Production Versions', from: null, to: '1', kind: 'added' },
      { path: 'quoteNumbers', label: 'Quote Numbers', from: null, to: 'Q-2026-0001', kind: 'added' },
    ]);
  });
});
