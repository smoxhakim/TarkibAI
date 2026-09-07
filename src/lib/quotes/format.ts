import { QUANTITY_SCALE } from './engine';

/**
 * Presentation helpers shared by the PDF template and the in-app UI.
 *
 * Kept in one module so a figure never reads one way on screen and another way
 * on the document a client receives.
 */

/** U+00A0. Written as an escape so it is visible in the source. */
export const GROUP_SEPARATOR = '\u00a0';

/** Formats integer minor units as "1 250.00 MAD", grouped with U+00A0. */
export function formatMoney(cents: number, currency: string): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const major = Math.floor(absolute / 100);
  const minor = absolute % 100;
  // Non-breaking spaces rather than commas: a comma is the decimal separator in
  // French-language Morocco, and the separator must not let an amount wrap
  // across a line on a document a client reads.
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  return `${negative ? '-' : ''}${grouped}.${String(minor).padStart(2, '0')} ${currency}`;
}

/** Formats a thousandths quantity as "2.5", dropping meaningless zeros. */
export function formatQuantity(quantityMilli: number): string {
  const value = quantityMilli / QUANTITY_SCALE;
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}

/** Parses user input like "2.5" into thousandths, or null if unusable. */
export function parseQuantity(input: string): number | null {
  const trimmed = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * QUANTITY_SCALE);
}

/** Parses user input like "1250.50" into integer minor units, or null. */
export function parseMoney(input: string): number | null {
  const trimmed = input.trim().replace(/ |\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/** "7 September 2026" — spelled out, because 07/09 is ambiguous across locales. */
export function formatDate(value: Date | string | null): string {
  if (value === null) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
