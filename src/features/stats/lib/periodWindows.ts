import { calendarDaysBetween } from '@/shared/format/format';
import { trendVerdict, verdictRung, type TrendMetric } from '@/shared/format/trend';
import type { VerdictRung } from '@/theme/colors';
import { formatSignedPercentage } from '@/shared/format';

interface DateRanges {
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
  const text = formatSignedPercentage(pct, 0);
  if (whole === 0) return { text, rung: 'neutral' };
  const direction = whole > 0 ? 'up' : 'down';
  return {
    text,
    rung: verdictRung(trendVerdict(SEASON_METRIC[metric], direction)),
  };
}
