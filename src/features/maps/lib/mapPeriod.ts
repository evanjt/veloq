/**
 * The map tab's period filter.
 *
 * The spans are the one period vocabulary, so a month here is the thirty days
 * it is on the fitness and section pickers. `year` is the map's own: the
 * calendar year to date, which is why it carries a label of its own rather
 * than reading as the `1Y` that means 365 days everywhere else.
 */

import { periodOptions, periodStart, type Period } from '@/shared/app/period';

export type MapPeriod = Extract<Period, 'all' | '6m' | '3m' | '1m' | '7d'> | 'year';

export const PERIOD_OPTIONS: { id: MapPeriod; labelKey: string }[] = [
  ...periodOptions<Extract<MapPeriod, Period>>(['all']),
  { id: 'year', labelKey: 'maps.periodThisYear' },
  ...periodOptions<Extract<MapPeriod, Period>>(['6m', '3m', '1m', '7d']),
];

/**
 * The map opens on the whole library, which is the one exception to
 * `DEFAULT_PERIOD`. The map is what an athlete opens to see everywhere they
 * have been, and six months of it answers a different question.
 */
export const DEFAULT_MAP_PERIOD = 'all' as const satisfies MapPeriod;

/** The instant the filter starts from. */
export function getPeriodStart(period: MapPeriod, now: Date = new Date()): Date {
  if (period === 'year') {
    const start = new Date(now);
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  return periodStart(period, now);
}
