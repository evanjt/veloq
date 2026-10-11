import { DEFAULT_PERIOD, periodOptions, periodRangeDays, SPAN_PERIODS } from '@/shared/app/period';
import type { Period } from '@/shared/app/period';

/** The periods Best Efforts offers: every span, then the whole history. */
export const BEST_EFFORTS_PERIODS = periodOptions<Period>([...SPAN_PERIODS, 'all']);

/** The window the screen opens on, the same as every other span picker. */
export const BEST_EFFORTS_DEFAULT_PERIOD: Period = DEFAULT_PERIOD;

/** The engine's curve key for a period: trailing days, or zero for the whole history. */
export function bestEffortsDays(period: Period): number {
  return periodRangeDays(period);
}

/** The link to Best Efforts that opens it on a period, so a drill-down keeps its window. */
export function bestEffortsHref(period: Period): string {
  return `/best-efforts?period=${period}`;
}

/** The period a link names, or the default when it names none the screen offers. */
export function bestEffortsPeriodFromParam(value: string | string[] | undefined): Period {
  const raw = Array.isArray(value) ? value[0] : value;
  return (
    BEST_EFFORTS_PERIODS.find((option) => option.id === raw)?.id ?? BEST_EFFORTS_DEFAULT_PERIOD
  );
}
