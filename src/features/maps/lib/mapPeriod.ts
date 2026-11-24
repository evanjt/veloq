/**
 * The map tab's period filter.
 *
 * The spans are the one period vocabulary, so a month here is the thirty days
 * it is on the fitness and section pickers. `year` is the map's own: the
 * calendar year to date, which is why it carries a label of its own rather
 * than reading as the `1Y` that means 365 days everywhere else.
 */

import { localWallClockToEpochSeconds } from '@/shared/time/startDate';
import { PERIOD_LABEL_KEYS, periodOptions, periodStart, type Period } from '@/shared/app/period';

export type MapPeriod = Extract<Period, 'all' | '6m' | '3m' | '1m' | '7d'> | 'year';

export const PERIOD_OPTIONS: { id: MapPeriod; labelKey: string }[] = [
  ...periodOptions<Extract<MapPeriod, Period>>(['all']),
  { id: 'year', labelKey: 'maps.periodThisYear' },
  ...periodOptions<Extract<MapPeriod, Period>>(['6m', '3m', '1m', '7d']),
];

/** The label the period button and its list read, the span named in full. */
export function periodSelectLabelKey(period: MapPeriod): string {
  return period === 'year' ? 'maps.periodThisYear' : PERIOD_LABEL_KEYS.long[period];
}

/**
 * The map opens on the whole library, which is an exception to
 * `DEFAULT_PERIOD`. The map is what an athlete opens to see everywhere they
 * have been, and six months of it answers a different question.
 */
export const DEFAULT_MAP_PERIOD = 'all' as const satisfies MapPeriod;

/**
 * Where the filter starts, as a `Date` whose instant is the local wall clock
 * stamped as UTC. The engine compares it with activity dates stored the same
 * way, so a true instant would slide the window by the device's UTC offset.
 */
export function getPeriodStart(period: MapPeriod, now: Date = new Date()): Date {
  if (period === 'year') return new Date(Date.UTC(now.getFullYear(), 0, 1));
  const start = periodStart(period, now);
  return new Date(period === 'all' ? start.getTime() : localWallClockToEpochSeconds(start) * 1000);
}
