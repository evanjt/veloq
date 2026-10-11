import { calendarDaysBetween, getMonday } from '@/shared/format/format';
import { trendVerdict, verdictRung, type TrendMetric } from '@/shared/format/trend';
import type { VerdictRung } from '@/theme/colors';

export type WindowRange = 'week' | 'month' | '3m' | '6m' | 'year';

export interface DateRanges {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
}

export interface DayWindow {
  start: Date;
  end: Date;
}

function dayOf(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * The previous window ends the same elapsed span after its start as the
 * current one has run, never past its own natural end. A period to date is only
 * ever set against the same part of an earlier period.
 */
function previousEndFor(currentStart: Date, today: Date, previousStart: Date, naturalEnd: Date) {
  const aligned = addDays(previousStart, calendarDaysBetween(currentStart, today));
  return aligned < naturalEnd ? aligned : naturalEnd;
}

function windows(
  currentStart: Date,
  today: Date,
  previousStart: Date,
  previousNaturalEnd: Date
): DateRanges {
  return {
    currentStart,
    currentEnd: today,
    previousStart,
    previousEnd: previousEndFor(currentStart, today, previousStart, previousNaturalEnd),
  };
}

/** The two windows a summary range compares, each ending the same elapsed span after its start. */
export function likeForLikeWindows(range: WindowRange, now: Date): DateRanges {
  const today = dayOf(now);
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (range) {
    case 'week': {
      const start = getMonday(today);
      return windows(start, today, addDays(start, -7), addDays(start, -1));
    }
    case 'month':
      return windows(new Date(y, m, 1), today, new Date(y, m - 1, 1), new Date(y, m, 0));
    case '3m':
      return windows(new Date(y, m - 2, 1), today, new Date(y, m - 5, 1), new Date(y, m - 2, 0));
    case '6m':
      return windows(new Date(y, m - 5, 1), today, new Date(y, m - 11, 1), new Date(y, m - 5, 0));
    default:
      return windows(new Date(y, 0, 1), today, new Date(y - 1, 0, 1), new Date(y - 1, 11, 31));
  }
}

export interface SeasonWindows {
  yearCurrent: DayWindow;
  yearPrevious: DayWindow;
  monthCurrent: DayWindow;
  monthPrevious: DayWindow;
}

/**
 * The year to date and the month to date, each against last year's same span.
 * The previous month ends on the same day of the month, capped at its length.
 */
export function seasonWindows(now: Date): SeasonWindows {
  const today = dayOf(now);
  const y = now.getFullYear();
  const m = now.getMonth();
  const year = windows(new Date(y, 0, 1), today, new Date(y - 1, 0, 1), new Date(y - 1, 11, 31));
  const month = windows(new Date(y, m, 1), today, new Date(y - 1, m, 1), new Date(y - 1, m + 1, 0));
  return {
    yearCurrent: { start: year.currentStart, end: year.currentEnd },
    yearPrevious: { start: year.previousStart, end: year.previousEnd },
    monthCurrent: { start: month.currentStart, end: month.currentEnd },
    monthPrevious: { start: month.previousStart, end: month.previousEnd },
  };
}

/**
 * The tooltip's percentage for one month, or null when it has none. A month
 * after the current one has not happened, so it has nothing to compare. The
 * current month is set against last year's same days, a past month whole
 * against whole, and a zero baseline has no percentage.
 */
export function seasonMonthChange(
  month: number,
  currentMonth: number,
  bar: { current: number; previous: number },
  toDate: { current: number; previous: number }
): number | null {
  if (month > currentMonth) return null;
  const { current, previous } = month === currentMonth ? toDate : bar;
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

/** What the season card compares, and the trend metric whose polarity judges it. */
const SEASON_METRIC: Record<'hours' | 'distance' | 'tss', TrendMetric> = {
  hours: 'weekHours',
  distance: 'weekDistance',
  tss: 'weekTss',
};

/**
 * A season percentage as the card prints it, and the rung it is drawn on. The
 * move is the printed whole percentage, so a change that rounds to nothing is
 * '0%' on the neutral rung rather than a green '+0%' or a red '-0%', and the
 * metric's polarity decides the rung, so load moves with no judgement.
 */
export function seasonChange(
  metric: 'hours' | 'distance' | 'tss',
  pct: number
): { text: string; rung: VerdictRung } {
  const whole = Math.round(Math.abs(pct)) * Math.sign(pct);
  if (whole === 0) return { text: '0%', rung: 'neutral' };
  const direction = whole > 0 ? 'up' : 'down';
  return {
    text: `${whole > 0 ? '+' : ''}${whole}%`,
    rung: verdictRung(trendVerdict(SEASON_METRIC[metric], direction)),
  };
}
