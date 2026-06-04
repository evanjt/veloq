/**
 * Shared date formatters for chart labels and tooltips.
 *
 * Charts need year-suffixed dates ("Jan 15 '24") because data often spans
 * multiple years. The base `formatShortDate` from `@/lib` doesn't include
 * year, so this module wraps it.
 */

import { formatShortDate as formatShortDateBase, getIntlLocale } from '@/lib';

/**
 * Format a date for chart tooltips and headers, with 2-digit year suffix.
 *
 * Examples:
 * - "Jan 15 '24"
 * - "Mar 3 '25"
 */
export function formatShortDateWithYear(date: Date): string {
  const base = formatShortDateBase(date);
  const year = date.getFullYear().toString().slice(-2);
  return `${base} '${year}`;
}
