import type { WellnessData } from '@/types';

/** The wellness values the readout lists, in the order it lists them. */
export type LoggedMetric = 'hrv' | 'restingHR' | 'sleepSecs' | 'sleepScore' | 'weight';

const LOGGED_ORDER: readonly LoggedMetric[] = [
  'hrv',
  'restingHR',
  'sleepSecs',
  'sleepScore',
  'weight',
];

/** What a day selected on the calendar grid states. */
export interface CalendarDayReadout {
  fitness: number | null;
  fatigue: number | null;
  /** Fitness less fatigue, null when either is missing. */
  form: number | null;
  /** Each value logged that day, in a fixed order. */
  logged: { metric: LoggedMetric; value: number }[];
}

/** The readout for one stored day, or null for a day with no stored row. */
export function calendarDayReadout(day: WellnessData | undefined): CalendarDayReadout | null {
  if (!day) return null;
  const fitness = day.ctl ?? null;
  const fatigue = day.atl ?? null;
  const logged: CalendarDayReadout['logged'] = [];
  for (const metric of LOGGED_ORDER) {
    const value = day[metric];
    if (value != null) logged.push({ metric, value });
  }
  return {
    fitness,
    fatigue,
    form: fitness !== null && fatigue !== null ? fitness - fatigue : null,
    logged,
  };
}
