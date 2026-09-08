/**
 * Formatting shared by every generated document.
 *
 * Lives here rather than in one document's module so the client quote and the
 * production package cannot drift into rendering the same value two ways.
 */

/** "7 September 2026" — spelled out, because 07/09 is ambiguous across locales. */
export function formatDate(value: Date | string | null): string {
  if (value === null) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
