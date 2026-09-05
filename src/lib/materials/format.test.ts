import { describe, expect, it } from 'vitest';
import {
  formatMillimetres,
  formatMoney,
  formatStockSize,
  formatThickness,
  sheetAreaSquareMetres,
} from './format';

describe('formatMillimetres', () => {
  it('renders whole metres without trailing zeros', () => {
    expect(formatMillimetres(6000)).toBe('6 m');
  });

  it('renders partial metres precisely', () => {
    expect(formatMillimetres(2440)).toBe('2.44 m');
    expect(formatMillimetres(1220)).toBe('1.22 m');
  });

  it('keeps sub-metre values in millimetres', () => {
    expect(formatMillimetres(800)).toBe('800 mm');
    expect(formatMillimetres(3)).toBe('3 mm');
  });
});

describe('formatStockSize', () => {
  const base = {
    standardLengthMm: null,
    sheetWidthMm: null,
    sheetHeightMm: null,
    thicknessMm: null,
  };

  it('shows a bar length for linear stock', () => {
    expect(formatStockSize({ ...base, measurementModel: 'linear', standardLengthMm: 6000 })).toBe('6 m');
  });

  it('shows both edges for sheet stock', () => {
    expect(
      formatStockSize({ ...base, measurementModel: 'sheet', sheetWidthMm: 2440, sheetHeightMm: 1220 })
    ).toBe('2.44 m × 1.22 m');
  });

  it('returns null for area and piece, which have no stock size', () => {
    expect(formatStockSize({ ...base, measurementModel: 'area' })).toBeNull();
    expect(formatStockSize({ ...base, measurementModel: 'piece' })).toBeNull();
  });

  it('returns null rather than a partial size when a dimension is missing', () => {
    expect(formatStockSize({ ...base, measurementModel: 'sheet', sheetWidthMm: 2440 })).toBeNull();
  });
});

describe('formatThickness', () => {
  it('formats whole and fractional thicknesses', () => {
    expect(formatThickness(3)).toBe('3 mm');
    expect(formatThickness(0.5)).toBe('0.5 mm');
  });

  it('returns null when unknown, so the UI shows a dash rather than "0 mm"', () => {
    expect(formatThickness(null)).toBeNull();
  });
});

describe('formatMoney', () => {
  it('converts integer minor units to a two-decimal display value', () => {
    expect(formatMoney(85000, 'MAD')).toBe('850.00 MAD');
    expect(formatMoney(1, 'MAD')).toBe('0.01 MAD');
    expect(formatMoney(0, 'MAD')).toBe('0.00 MAD');
  });

  it('honours a different currency', () => {
    expect(formatMoney(2500, 'EUR')).toBe('25.00 EUR');
  });
});

describe('sheetAreaSquareMetres', () => {
  it('computes the area of a standard panel', () => {
    expect(sheetAreaSquareMetres(2440, 1220)).toBeCloseTo(2.9768, 4);
  });

  it('computes a one square metre sheet exactly', () => {
    expect(sheetAreaSquareMetres(1000, 1000)).toBe(1);
  });
});
