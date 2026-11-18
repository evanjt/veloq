// A list's filter: the text a table's toolbar field holds, kept in the address as `q=` so a
// reload or a shared link restores it, the match a page that holds all its rows applies, and the
// "N of M" count the field reports. Pure, so a test drives it without a browser.

import { queryValue, withQuery, type Route } from '../router';

/** The hash key the filter text is kept under. */
export const FILTER_KEY = 'q';

/** The filter text in a route, or an empty string. */
export function readFilterText(route: Route): string {
  return queryValue(route, FILTER_KEY) ?? '';
}

/** The route with its filter text set; a blank text leaves no key. */
export function withFilterText(route: Route, text: string): Route {
  return withQuery(route, { [FILTER_KEY]: text.trim() === '' ? null : text });
}

/** True when every word of `text` is found, ignoring case, in one of the row's fields. */
export function matchesFilter(
  text: string,
  fields: readonly (string | null | undefined)[]
): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const held = fields.map((field) => (field ?? '').toLowerCase());
  return words.every((word) => held.some((field) => field.includes(word)));
}

export type FilterCount = { shown: number; total: number };

/** How many rows the filter leaves of how many are held; the total is never below what is shown. */
export function filterCount(shown: number, total: number): FilterCount {
  return { shown, total: Math.max(shown, total) };
}
