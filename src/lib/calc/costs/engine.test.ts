import { describe, expect, it } from 'vitest';
import {
  applyBasisPoints,
  calculateProjectCost,
  toClientSafeCost,
  type CostInput,
  type CostSettingsInput,
} from './engine';

const settings = (overrides: Partial<CostSettingsInput> = {}): CostSettingsInput => ({
  laborType: 'percent',
  laborBp: 3000, // 30%
  laborCents: 0,
  transportType: 'fixed',
  transportBp: 0,
  transportCents: 50000, // 500.00
  installType: 'percent',
  installBp: 1000, // 10%
  installCents: 0,
  marginBp: 2500, // 25%
  taxBp: 2000, // 20% TVA
  ...overrides,
});

const input = (overrides: Partial<CostInput> = {}): CostInput => ({
  settings: settings(),
  materialsCostCents: 1_000_00, // 1000.00
  expensesCents: [],
  ...overrides,
});

describe('applyBasisPoints', () => {
  it('applies whole percentages exactly', () => {
    expect(applyBasisPoints(100_00, 2000)).toBe(20_00);
    expect(applyBasisPoints(100_00, 10_000)).toBe(100_00);
  });

  it('applies half percentages, which whole-integer percent could not express', () => {
    expect(applyBasisPoints(100_00, 1250)).toBe(12_50); // 12.5%
    expect(applyBasisPoints(100_00, 750)).toBe(7_50); // 7.5%
  });

  it('returns whole minor units, never a fraction', () => {
    const result = applyBasisPoints(3333, 1250);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('rounds half away from zero rather than toward positive infinity', () => {
    // 1 cent at 50% is exactly 0.5 — it must round to 1, and -1 to -1.
    expect(applyBasisPoints(1, 5000)).toBe(1);
    expect(applyBasisPoints(-1, 5000)).toBe(-1);
  });

  it('is zero at zero basis points', () => {
    expect(applyBasisPoints(999_99, 0)).toBe(0);
  });
});

describe('calculateProjectCost — a worked breakdown', () => {
  it('computes each component from the material cost', () => {
    const result = calculateProjectCost(input());

    expect(result.materialsCostCents).toBe(100000);
    expect(result.laborCostCents).toBe(30000); // 30% of materials
    expect(result.transportCostCents).toBe(50000); // fixed
    expect(result.installCostCents).toBe(10000); // 10% of materials
    expect(result.internalTotalCents).toBe(190000);
  });

  it('applies margin to the internal total and tax to the client subtotal', () => {
    const result = calculateProjectCost(input());

    expect(result.marginCents).toBe(47500); // 25% of 190000
    expect(result.clientSubtotalCents).toBe(237500);
    expect(result.taxCents).toBe(47500); // 20% of 237500
    expect(result.clientTotalCents).toBe(285000);
  });

  it('does not tax the margin separately — tax applies once, to the subtotal', () => {
    const result = calculateProjectCost(input());
    // A common costing error is taxing internal total and margin separately.
    expect(result.taxCents).toBe(applyBasisPoints(result.clientSubtotalCents, 2000));
  });

  it('keeps percentage components independent of one another', () => {
    // Labour is 30% of materials whether or not transport exists — components
    // do not compound, so the breakdown can be checked by hand.
    const withTransport = calculateProjectCost(input());
    const withoutTransport = calculateProjectCost(
      input({ settings: settings({ transportType: 'fixed', transportCents: 0 }) })
    );
    expect(withTransport.laborCostCents).toBe(withoutTransport.laborCostCents);
  });
});

describe('component types', () => {
  it('uses the fixed amount when a component is fixed', () => {
    const result = calculateProjectCost(
      input({ settings: settings({ laborType: 'fixed', laborCents: 12345, laborBp: 9999 }) })
    );
    // The basis-points value must be ignored entirely for a fixed component.
    expect(result.laborCostCents).toBe(12345);
  });

  it('uses the per-project amount when a component is manual', () => {
    const result = calculateProjectCost(
      input({
        settings: settings({ transportType: 'manual' }),
        manualOverrides: { transportCents: 7500 },
      })
    );
    expect(result.transportCostCents).toBe(7500);
  });

  it('treats an unentered manual amount as zero rather than guessing', () => {
    const result = calculateProjectCost(input({ settings: settings({ transportType: 'manual' }) }));
    expect(result.transportCostCents).toBe(0);
  });

  it('never produces a negative component', () => {
    const result = calculateProjectCost(
      input({
        settings: settings({ laborType: 'fixed', laborCents: -500 }),
        expensesCents: [-100],
      })
    );
    expect(result.laborCostCents).toBe(0);
    expect(result.otherCostCents).toBe(0);
  });
});

describe('expenses', () => {
  it('sums per-project expenses into the internal total', () => {
    const result = calculateProjectCost(input({ expensesCents: [25000, 8000] }));
    expect(result.otherCostCents).toBe(33000);
    expect(result.internalTotalCents).toBe(100000 + 30000 + 50000 + 10000 + 33000);
  });

  it('is zero with no expenses', () => {
    expect(calculateProjectCost(input()).otherCostCents).toBe(0);
  });
});

describe('edge cases', () => {
  it('handles a zero-material project without dividing by zero', () => {
    const result = calculateProjectCost(input({ materialsCostCents: 0 }));
    expect(result.laborCostCents).toBe(0);
    expect(result.transportCostCents).toBe(50000); // fixed still applies
    expect(result.internalTotalCents).toBe(50000);
  });

  it('produces a client total equal to the internal total when margin and tax are zero', () => {
    const result = calculateProjectCost(
      input({ settings: settings({ marginBp: 0, taxBp: 0 }) })
    );
    expect(result.clientTotalCents).toBe(result.internalTotalCents);
  });

  it('keeps every output an integer number of minor units', () => {
    const result = calculateProjectCost(
      input({
        materialsCostCents: 33_33,
        settings: settings({ laborBp: 1234, marginBp: 1750, taxBp: 2000 }),
        expensesCents: [777],
      })
    );
    for (const value of Object.values(result)) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(calculateProjectCost(input())).toEqual(calculateProjectCost(input()));
  });

  it('keeps the breakdown internally consistent', () => {
    const result = calculateProjectCost(input({ expensesCents: [1234] }));
    expect(result.internalTotalCents).toBe(
      result.materialsCostCents +
        result.laborCostCents +
        result.transportCostCents +
        result.installCostCents +
        result.otherCostCents
    );
    expect(result.clientSubtotalCents).toBe(result.internalTotalCents + result.marginCents);
    expect(result.clientTotalCents).toBe(result.clientSubtotalCents + result.taxCents);
  });
});

describe('toClientSafeCost — the leak boundary', () => {
  // Deliberately chosen so every internal figure differs from every client
  // figure. With round settings margin and tax can legitimately coincide, which
  // would make a value-based leak assertion fail on a correct result.
  const breakdown = calculateProjectCost(
    input({
      materialsCostCents: 123_45,
      settings: settings({ marginBp: 3300, taxBp: 2000 }),
      expensesCents: [777],
    })
  );
  const safe = toClientSafeCost(breakdown);

  it('the fixture keeps internal and client figures distinct', () => {
    const internal = [breakdown.internalTotalCents, breakdown.marginCents];
    const client = [safe.subtotalCents, safe.taxCents, safe.totalCents];
    for (const value of internal) {
      expect(client).not.toContain(value);
    }
  });

  it('exposes exactly three fields and nothing else', () => {
    expect(Object.keys(safe).sort()).toEqual(['subtotalCents', 'taxCents', 'totalCents']);
  });

  it('never carries any internal field, whatever the key is called', () => {
    const forbidden = [
      'materialsCostCents',
      'laborCostCents',
      'transportCostCents',
      'installCostCents',
      'otherCostCents',
      'internalTotalCents',
      'marginCents',
    ];
    for (const key of forbidden) {
      expect(key in safe).toBe(false);
    }
  });

  it('does not leak the margin through a serialized payload', () => {
    // What actually reaches a PDF or an API response is the serialized form,
    // so the check that matters is on the JSON, not just the object keys.
    const json = JSON.stringify(safe);
    expect(json).not.toContain('margin');
    expect(json).not.toContain('internal');
    expect(json).not.toContain(String(breakdown.marginCents));
    expect(json).not.toContain(String(breakdown.internalTotalCents));
  });

  it('carries the correct client-facing values', () => {
    expect(safe.subtotalCents).toBe(breakdown.clientSubtotalCents);
    expect(safe.taxCents).toBe(breakdown.taxCents);
    expect(safe.totalCents).toBe(breakdown.clientTotalCents);
  });

  it('is built by construction, so a new internal field cannot leak by default', () => {
    const polluted = { ...breakdown, secretProfitPlan: 999999 } as never;
    const result = toClientSafeCost(polluted);
    expect(JSON.stringify(result)).not.toContain('999999');
    expect(Object.keys(result)).toHaveLength(3);
  });
});
