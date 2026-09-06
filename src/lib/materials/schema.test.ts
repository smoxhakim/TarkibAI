import { describe, expect, it } from 'vitest';
import { createMaterialSchema, materialQuerySchema } from './schema';

const sheet = {
  name: 'Alucobond 3mm noir',
  category: 'Panel',
  measurementModel: 'sheet' as const,
  sheetWidthMm: 2440,
  sheetHeightMm: 1220,
  thicknessMm: 3,
  unitPriceCents: 85000,
};

const linear = {
  name: 'Tube carré 40x40',
  category: 'Metal',
  measurementModel: 'linear' as const,
  standardLengthMm: 6000,
  unitPriceCents: 12000,
};

describe('createMaterialSchema — measurement model rules', () => {
  it('accepts a sheet with both stock dimensions', () => {
    expect(createMaterialSchema.safeParse(sheet).success).toBe(true);
  });

  it('accepts a linear material with a stock length', () => {
    expect(createMaterialSchema.safeParse(linear).success).toBe(true);
  });

  it('rejects a linear material with no stock length', () => {
    // Without this, T4 could not work out how many bars to buy.
    const result = createMaterialSchema.safeParse({ ...linear, standardLengthMm: undefined });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('standard stock length');
  });

  it('rejects a sheet missing either dimension', () => {
    expect(createMaterialSchema.safeParse({ ...sheet, sheetWidthMm: undefined }).success).toBe(false);
    expect(createMaterialSchema.safeParse({ ...sheet, sheetHeightMm: undefined }).success).toBe(false);
  });

  it('requires no dimensions for area or piece materials', () => {
    expect(
      createMaterialSchema.safeParse({
        name: 'Vinyle',
        category: 'Vinyl',
        measurementModel: 'area',
        unitPriceCents: 4500,
      }).success
    ).toBe(true);

    expect(
      createMaterialSchema.safeParse({
        name: 'Module LED',
        category: 'Lighting',
        measurementModel: 'piece',
        unitPriceCents: 1200,
      }).success
    ).toBe(true);
  });
});

describe('createMaterialSchema — value rules', () => {
  it('rejects a fractional millimetre dimension', () => {
    // Stock dimensions are integer millimetres so purchase counts stay exact.
    expect(createMaterialSchema.safeParse({ ...linear, standardLengthMm: 6000.5 }).success).toBe(false);
  });

  it('rejects zero or negative dimensions', () => {
    expect(createMaterialSchema.safeParse({ ...linear, standardLengthMm: 0 }).success).toBe(false);
    expect(createMaterialSchema.safeParse({ ...linear, standardLengthMm: -6000 }).success).toBe(false);
  });

  it('rejects a negative price', () => {
    expect(createMaterialSchema.safeParse({ ...sheet, unitPriceCents: -1 }).success).toBe(false);
  });

  it('accepts a zero price, since some stock is offcut or supplied free', () => {
    expect(createMaterialSchema.safeParse({ ...sheet, unitPriceCents: 0 }).success).toBe(true);
  });

  it('rejects a fractional price, because money is integer minor units', () => {
    expect(createMaterialSchema.safeParse({ ...sheet, unitPriceCents: 850.5 }).success).toBe(false);
  });

  it('accepts a fractional thickness such as 0.5 mm', () => {
    expect(createMaterialSchema.safeParse({ ...sheet, thicknessMm: 0.5 }).success).toBe(true);
  });

  it('rejects an unknown measurement model', () => {
    expect(createMaterialSchema.safeParse({ ...sheet, measurementModel: 'volume' }).success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(createMaterialSchema.safeParse({ ...sheet, name: '   ' }).success).toBe(false);
  });

  it('accepts French and Arabic material names', () => {
    expect(createMaterialSchema.safeParse({ ...sheet, name: 'Plexiglas opale 5mm' }).success).toBe(true);
    expect(createMaterialSchema.safeParse({ ...sheet, name: 'صفيحة ألوكوبوند' }).success).toBe(true);
  });
});

describe('materialQuerySchema', () => {
  it('defaults to excluding archived materials', () => {
    expect(materialQuerySchema.parse({}).includeArchived).toBe(false);
  });

  it('rejects an unknown measurement model filter', () => {
    expect(materialQuerySchema.safeParse({ measurementModel: 'nonsense' }).success).toBe(false);
  });
});
