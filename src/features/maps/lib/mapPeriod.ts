/**
 * The map tab's period filter.
 *
 * A month here is thirty days, the same span the fitness and section pickers
 * use, because two chips reading "1 mo" and "1M" on adjacent tabs must not
 * cover different ranges. `setMonth` was the earlier arithmetic and it also
 * overflows: a month back from 31 January lands in March.
 *
 * `all` and `year` are deliberately not spans. `all` reaches back past any
 * library, and `year` is the calendar year to date, which is why it carries a
 * label of its own rather than reading as the `1Y` that means 365 days
 * everywhere else.
 */

export type PeriodKey = 'all' | 'year' | '6m' | '3m' | '1m' | '1w';

/** Spans, in days. `all` and `year` are absent because neither is one. */
export const PERIOD_DAYS = {
  '6m': 180,
  '3m': 90,
  '1m': 30,
  '1w': 7,
} as const;

const ALL_TIME_START = new Date('2000-01-01');

export const PERIOD_OPTIONS: { key: PeriodKey; labelKey: string }[] = [
  { key: 'all', labelKey: 'maps.periodAll' },
  { key: 'year', labelKey: 'maps.periodThisYear' },
  { key: '6m', labelKey: 'maps.periodSixMonths' },
  { key: '3m', labelKey: 'maps.periodThreeMonths' },
  { key: '1m', labelKey: 'maps.periodOneMonth' },
  { key: '1w', labelKey: 'maps.periodOneWeek' },
];

const DAY_MS = 86_400_000;

/** The instant the filter starts from, at local midnight for the day spans. */
export function getPeriodStart(period: PeriodKey, now: Date = new Date()): Date {
  if (period === 'all') return ALL_TIME_START;
  if (period === 'year') {
    const start = new Date(now);
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  return new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS);
}
