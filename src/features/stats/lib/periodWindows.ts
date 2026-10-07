import { getMonday } from '@/shared/format/format';

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

const MS_PER_DAY = 86_400_000;

function dayOf(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whole calendar days from `from` to `to`, counted over local dates so a DST shift cannot move it. */
function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
      MS_PER_DAY
  );
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
  const aligned = addDays(previousStart, daysBetween(currentStart, today));
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
