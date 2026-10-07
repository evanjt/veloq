/**
 * The feed's date range.
 *
 * A range is two inclusive calendar days. The feed reads it newest first in
 * 30-day pages that never leave it, so a range set to a month reads that
 * month and stops, however far back it lies.
 */

import { addDaysToDay } from '@/shared/time/startDate';

export interface FeedRange {
  oldest: string;
  newest: string;
}

export const FEED_RANGE_PAGE_DAYS = 30;

export const FEED_RANGE_PRESETS = ['last90Days', 'thisYear', 'lastYear'] as const;

export type FeedRangePreset = (typeof FEED_RANGE_PRESETS)[number];

/** The range a preset names, as of the calendar day `today` (YYYY-MM-DD). */
export function feedRangeForPreset(preset: FeedRangePreset, today: string): FeedRange {
  const year = Number(today.slice(0, 4));
  switch (preset) {
    case 'last90Days':
      return { oldest: addDaysToDay(today, -89), newest: today };
    case 'thisYear':
      return { oldest: `${year}-01-01`, newest: today };
    default:
      return { oldest: `${year - 1}-01-01`, newest: `${year - 1}-12-31` };
  }
}

/** True when both ranges name the same days. */
export function sameFeedRange(a: FeedRange | null, b: FeedRange | null): boolean {
  if (!a || !b) return a === b;
  return a.oldest === b.oldest && a.newest === b.newest;
}

/** The newest page of a range. */
export function firstRangePage(range: FeedRange): FeedRange {
  const oldest = addDaysToDay(range.newest, -(FEED_RANGE_PAGE_DAYS - 1));
  return { oldest: oldest < range.oldest ? range.oldest : oldest, newest: range.newest };
}

/** The page older than `page`, or undefined once the range's first day is read. */
export function olderRangePage(range: FeedRange, page: FeedRange): FeedRange | undefined {
  if (page.oldest <= range.oldest) return undefined;
  const newest = addDaysToDay(page.oldest, -1);
  const oldest = addDaysToDay(newest, -(FEED_RANGE_PAGE_DAYS - 1));
  return { oldest: oldest < range.oldest ? range.oldest : oldest, newest };
}
