// What the fitness page asks of the phone, and the slots its answers land in.
// No browser API, so a test drives it. The numbers shown are the engine's: this
// file only says which window each ask covers.

import type { Methods } from './schema';

/** The ranges the range control offers, in days. */
export const RANGES = [42, 90, 180, 365] as const;

/** The periods the best efforts control offers, in days, 0 for all time. */
export const BEST_EFFORT_PERIODS = [0, 90, 365] as const;

type Method = keyof Methods;

/** One ask: the slot its answer is kept in, the method and the params. */
export type PanelAsk = { slot: string; method: Method; params: object };

const pad = (n: number) => String(n).padStart(2, '0');

/** A local calendar day as `YYYY-MM-DD`. */
export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A local wall-clock reading as the epoch seconds the engine stores activity
 * dates in: the same digits read as UTC.
 */
export function wallSeconds(date: Date): number {
  return (
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds()
    ) / 1000
  );
}

/**
 * The present to the five minutes. A read that carries the time is keyed by it,
 * so the time given must hold still while a page stays open, or the read would
 * be asked again on every render.
 */
export function settledNow(now: number = Date.now()): Date {
  const step = 5 * 60 * 1000;
  return new Date(Math.floor(now / step) * step);
}

const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

function daysBefore(date: Date, days: number): Date {
  const day = midnight(date);
  day.setDate(day.getDate() - days);
  return day;
}

/** The trailing window of `days` whole local days through the end of today. */
function trailing(days: number, now: Date) {
  const end = midnight(now);
  end.setHours(23, 59, 59, 0);
  return { start: daysBefore(now, days), end };
}

/** The panels whose window is the range: each is asked again when the range changes. */
export function rangeAsks(days: number, now: Date, sport = 'Ride'): PanelAsk[] {
  const { start, end } = trailing(days, now);
  const window = { startTs: wallSeconds(start), endTs: wallSeconds(end) };
  return [
    {
      slot: 'wellness',
      method: 'fitness.wellness',
      params: { oldest: dayOf(start), newest: dayOf(end) },
    },
    { slot: 'loads', method: 'fitness.loads', params: window },
    {
      slot: 'zones',
      method: 'fitness.zones',
      params: { sportType: sport, zoneType: sport === 'Ride' ? 'power' : 'hr', ...window },
    },
    { slot: 'powerCurve', method: 'fitness.powerCurve', params: { sport: 'Ride', days } },
    {
      slot: 'paceCurve',
      method: 'fitness.paceCurve',
      params: { sport: sport === 'Swim' ? 'Swim' : 'Run', days, gap: false },
    },
  ];
}

/** The best efforts ask, which has its own period and does not follow the range. */
export function bestEffortsAsk(days: number): PanelAsk {
  return { slot: 'bestEfforts', method: 'fitness.bestEfforts', params: { days } };
}

const wallDay = (date: Date, end: boolean) => {
  const day = midnight(date);
  if (end) day.setHours(23, 59, 59, 0);
  return wallSeconds(day);
};

/**
 * The screen read, asked once per connection: the calendar windows run from
 * the start of last year and from a year of heatmap days back to today. The
 * season windows follow from the instant, which the engine reads.
 */
export function screenAsk(now: Date): PanelAsk {
  const today = midnight(now);
  const year = today.getFullYear();
  const span = (start: Date, end: Date) => ({
    startTs: wallDay(start, false),
    endTs: wallDay(end, true),
  });
  return {
    slot: 'screen',
    method: 'fitness.screen',
    params: {
      spanDays: [...RANGES],
      windows: {
        heatmapFirstDay: dayOf(daysBefore(today, 364)),
        heatmapLastDay: dayOf(today),
        months: span(new Date(year - 1, 0, 1), today),
        nowWallSeconds: wallSeconds(now),
      },
    },
  };
}

/** Points as an SVG path, a gap wherever a value is missing. */
export function linePath(points: (readonly [number, number] | null)[]): string {
  let path = '';
  let pen = false;
  for (const point of points) {
    if (!point) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`;
    pen = true;
  }
  return path;
}

/** Where `value` falls between `low` and `high`, 0 to 1; the middle when they are equal. */
export function fraction(value: number, low: number, high: number): number {
  return high === low ? 0.5 : (value - low) / (high - low);
}
