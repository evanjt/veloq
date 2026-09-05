/**
 * What a period is.
 *
 * Five pickers answered this with five key sets, five label sets, four day
 * tables and their own arithmetic, so seven days had five names and a month
 * was thirty days on one tab and a calendar month on the next. This is the one
 * vocabulary: a period is a key, a span is a number of trailing days, and a
 * month is thirty of them everywhere. `all` is the one period with no length.
 *
 * Calendar periods, this week or this year, are a different question, the
 * comparison of one calendar unit against the last, and stay where they are.
 */

export type Period = '7d' | '1m' | '3m' | '6m' | '1y' | 'all';

/** The periods that are a span of days. */
export type SpanPeriod = Exclude<Period, 'all'>;

export const SPAN_PERIODS: readonly SpanPeriod[] = ['7d', '1m', '3m', '6m', '1y'];

export const PERIOD_DAYS: Record<SpanPeriod, number> = {
  '7d': 7,
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

/**
 * One label per period per locale: `short` for a chip, `long` for prose. The
 * keys are literal so the unused-key sweep can see each one.
 */
export const PERIOD_LABEL_KEYS = {
  short: {
    '7d': 'period.short.7d',
    '1m': 'period.short.1m',
    '3m': 'period.short.3m',
    '6m': 'period.short.6m',
    '1y': 'period.short.1y',
    all: 'period.short.all',
  },
  long: {
    '7d': 'period.long.7d',
    '1m': 'period.long.1m',
    '3m': 'period.long.3m',
    '6m': 'period.long.6m',
    '1y': 'period.long.1y',
    all: 'period.long.all',
  },
} as const satisfies Record<'short' | 'long', Record<Period, string>>;

export interface PeriodOption<P extends Period = Period> {
  id: P;
  labelKey: string;
}

/** A picker's options, in the order given, each with its short label key. */
export function periodOptions<P extends Period>(ids: readonly P[]): PeriodOption<P>[] {
  return ids.map((id) => ({ id, labelKey: PERIOD_LABEL_KEYS.short[id] }));
}

/** The span in days, or zero for `all`, which is how the engine says no limit. */
export function periodRangeDays(period: Period): number {
  return period === 'all' ? 0 : PERIOD_DAYS[period];
}

const DAY_MS = 86_400_000;
const ALL_TIME_START = new Date('2000-01-01');

/**
 * The instant a period starts from. Days are counted, never calendar months:
 * `setMonth` a month back from 31 January lands in March.
 */
export function periodStart(period: Period, now: Date = new Date()): Date {
  if (period === 'all') return ALL_TIME_START;
  return new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS);
}
