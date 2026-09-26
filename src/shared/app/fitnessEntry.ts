/**
 * Where the fitness tab opens when a card sends the athlete there.
 *
 * An insight card summarises a window and a day. The tab read no params, so a
 * "HRV trending down over 14 days" card landed on the default six-month range
 * with nothing selected and the athlete scrolled for the window the card had
 * just described.
 */

import { SPAN_PERIODS } from '@/shared/app/period';
import type { TimeRange } from '@/shared/app/timeRange';

export interface FitnessEntry {
  /** The range to open on, or null to keep the screen's own. */
  range: TimeRange | null;
  /** The day to select, `YYYY-MM-DD`, or null to select none. */
  date: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRange(value: string): value is TimeRange {
  return (SPAN_PERIODS as readonly string[]).includes(value);
}

/** A day the chart can select: a real calendar date, written as the engine writes it. */
function isDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The range and day a set of route params asks for. Anything unparseable is
 * dropped rather than guessed, so a stale or hand-typed link opens the screen
 * on its own defaults instead of an invented window.
 */
export function fitnessEntryFromParams(params: {
  range?: string | string[];
  date?: string | string[];
}): FitnessEntry {
  const range = first(params.range);
  const date = first(params.date);
  return {
    range: range && isRange(range) ? range : null,
    date: date && isDay(date) ? date : null,
  };
}

/** Expo router hands a repeated param as an array. The first one wins. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The narrowest range that still covers a trailing window, so a fourteen-day
 * verdict opens on a month rather than six of them.
 */
export function rangeCovering(days: number): TimeRange {
  const covering = SPAN_PERIODS.find((period) => PERIOD_SPAN[period] >= days);
  return covering ?? SPAN_PERIODS[SPAN_PERIODS.length - 1];
}

const PERIOD_SPAN: Record<TimeRange, number> = {
  '7d': 7,
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

/** The link a card uses to open the fitness tab on its own window. */
export function fitnessTarget(entry: Partial<FitnessEntry>): string {
  const params = new URLSearchParams();
  if (entry.range) params.set('range', entry.range);
  if (entry.date) params.set('date', entry.date);
  const query = params.toString();
  return query ? `/fitness?${query}` : '/fitness';
}
