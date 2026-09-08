import { describe, expect, it } from 'vitest';
import { NO_SUPPLIER, groupPurchases, type PurchaseLineInput } from './purchasing';

const line = (patch: Partial<PurchaseLineInput> = {}): PurchaseLineInput => ({
  materialId: 'm1',
  materialName: 'Aluminium tube',
  supplierId: 's1',
  supplierLabel: 'Metaux Casa',
  stockSize: '6 m',
  unitsToPurchase: 5,
  unitPriceCents: 20_000,
  unsupportedReason: null,
  warnings: [],
  ...patch,
});

describe('groupPurchases', () => {
  it('groups by supplier and totals the group', () => {
    const groups = groupPurchases(
      [line(), line({ materialId: 'm2', materialName: 'Angle', unitsToPurchase: 2 })],
      { includePrices: true }
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].supplierName).toBe('Metaux Casa');
    expect(groups[0].lines).toHaveLength(2);
    expect(groups[0].subtotalCents).toBe(5 * 20_000 + 2 * 20_000);
  });

  it('separates suppliers and puts the unattributed group last', () => {
    const groups = groupPurchases(
      [
        line({ supplierId: 's2', supplierLabel: 'Zellij Co' }),
        line({ supplierId: null, supplierLabel: null, materialId: 'm3' }),
        line(),
      ],
      { includePrices: true }
    );

    expect(groups.map((group) => group.supplierName)).toEqual([
      'Metaux Casa',
      'Zellij Co',
      NO_SUPPLIER,
    ]);
  });

  it('omits every price when the caller may not see them', () => {
    // Whether somebody may see what material costs is a permission, and the
    // number must not reach the payload at all.
    const groups = groupPurchases([line()], { includePrices: false });

    expect(groups[0].lines[0].lineTotalCents).toBeNull();
    expect(groups[0].subtotalCents).toBeNull();
    // The quantity is exactly what a buyer without cost access still needs.
    expect(groups[0].lines[0].unitsToPurchase).toBe(5);
  });

  it('keeps an uncalculable line rather than dropping it', () => {
    // A list that silently omits a material is how somebody arrives at the yard
    // missing half the job.
    const groups = groupPurchases(
      [
        line(),
        line({
          materialId: 'm4',
          materialName: 'Dibond',
          unitsToPurchase: null,
          unsupportedReason: 'The material has no sheet dimensions.',
        }),
      ],
      { includePrices: true }
    );

    expect(groups[0].lines).toHaveLength(2);
    expect(groups[0].lines[1].unsupportedReason).toMatch(/no sheet dimensions/);
    expect(groups[0].incomplete).toBe(true);
  });

  it('gives no subtotal for a group it cannot total', () => {
    // A subtotal that quietly skipped a line would read as a complete order
    // value, which is worse than showing none.
    const groups = groupPurchases(
      [line(), line({ materialId: 'm4', unitsToPurchase: null, unsupportedReason: 'Missing size.' })],
      { includePrices: true }
    );

    expect(groups[0].subtotalCents).toBeNull();
  });

  it('carries the calculation\'s caveats to whoever is ordering', () => {
    const groups = groupPurchases(
      [line({ warnings: ['This is a MINIMUM. Bars are counted by total length.'] })],
      { includePrices: true }
    );

    expect(groups[0].lines[0].warnings[0]).toMatch(/MINIMUM/);
  });

  it('returns nothing for a project with no materials', () => {
    expect(groupPurchases([], { includePrices: true })).toEqual([]);
  });
});
