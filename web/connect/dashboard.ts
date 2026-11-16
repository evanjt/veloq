// What the fitness and insights dashboards lay out. No browser API, so a test
// drives it. The numbers shown are the engine's: this file only chooses which
// rows go where and how they are ordered.

import { RANGES } from './fitness';
import type { Route } from './router';
import { queryValue } from './router';
import type { Methods } from './schema';
import { orderRows } from './tableOrder';

/** The sports the sport control offers; it picks the zone and curve reads. */
export const FITNESS_SPORTS = ['Ride', 'Run', 'Swim'] as const;
export type FitnessSport = (typeof FITNESS_SPORTS)[number];

/** The range shown when the address names none. */
export const DEFAULT_RANGE = RANGES[1];

export type FitnessChoices = { range: number; sport: FitnessSport; open: string | null };

/** The range, sport and open activity an address holds; anything unknown is the default. */
export function fitnessChoices(route: Route): FitnessChoices {
  const range = Number(queryValue(route, 'range'));
  const sport = queryValue(route, 'sport');
  return {
    range: (RANGES as readonly number[]).includes(range) ? range : DEFAULT_RANGE,
    sport: (FITNESS_SPORTS as readonly string[]).includes(sport ?? '')
      ? (sport as FitnessSport)
      : FITNESS_SPORTS[0],
    open: queryValue(route, 'open') || null,
  };
}

/** The route with these choices written into its query; a default is left out. */
export function fitnessQuery(route: Route, choices: FitnessChoices): Route {
  const query: [string, string][] = route.query.filter(
    ([key]) => key !== 'range' && key !== 'sport' && key !== 'open'
  );
  if (choices.range !== DEFAULT_RANGE) query.push(['range', String(choices.range)]);
  if (choices.sport !== FITNESS_SPORTS[0]) query.push(['sport', choices.sport]);
  if (choices.open) query.push(['open', choices.open]);
  return { ...route, query };
}

type Dot = { activityId: string; startDateLocal: string };

/** The activities that began on a local day, `YYYY-MM-DD`, in start order. */
export function dotsOnDay(dots: readonly Dot[], day: string): string[] {
  return dots
    .filter((dot) => dot.startDateLocal.slice(0, 10) === day)
    .sort((a, b) => (a.startDateLocal < b.startDateLocal ? -1 : 1))
    .map((dot) => dot.activityId);
}

export type MonthRow = {
  key: string;
  count: number | null;
  load: number | null;
  distance: number | null;
  duration?: number | null;
};

export type MonthColumn = 'month' | 'count' | 'load' | 'distance' | 'duration';

/** The months table as rows, one per calendar month the screen read holds. */
export function monthRows(months: Methods['fitness.screen']['result']['months']): MonthRow[] {
  return months.map((month) => ({
    key: `${month.year}-${String(month.month).padStart(2, '0')}`,
    count: month.stats.count,
    load: month.stats.totalTss,
    distance: month.stats.totalDistance,
    duration: month.stats.totalDuration,
  }));
}

/**
 * The rows ordered by one column. A row with no value for the column goes last
 * in either direction, and rows with equal values keep their order.
 */
export function sortMonths(
  rows: readonly MonthRow[],
  column: MonthColumn,
  direction: 'asc' | 'desc'
): MonthRow[] {
  return orderRows(rows, { column, descending: direction === 'desc' }, (row, name) =>
    name === 'month' ? row.key : (row[name] ?? null)
  );
}

type HeatDay = { date: string; intensity: number; activityCount: number };
export type Cell = HeatDay | null;
export type CalendarYear = { year: number; weeks: Cell[][] };

/** The weekday of a `YYYY-MM-DD` day, 0 for Sunday. */
function weekday(date: string): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The heatmap days as one row of weeks per calendar year, newest year first.
 * Each week holds seven cells from `firstDay` (0 for Sunday, 1 for Monday); a
 * day the read does not hold is an empty cell.
 */
export function calendarYears(days: readonly HeatDay[], firstDay: number): CalendarYear[] {
  const byYear = new Map<number, HeatDay[]>();
  for (const day of days) {
    const year = Number(day.date.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), day]);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, held]) => {
      const sorted = [...held].sort((a, b) => (a.date < b.date ? -1 : 1));
      const weeks: Cell[][] = [];
      let week: Cell[] = [];
      let column = (weekday(sorted[0]?.date ?? '') - firstDay + 7) % 7;
      for (let pad = 0; pad < column; pad++) week.push(null);
      for (const day of sorted) {
        column = (weekday(day.date) - firstDay + 7) % 7;
        while (week.length < column) week.push(null);
        week.push(day);
        if (week.length === 7) {
          weeks.push(week);
          week = [];
        }
      }
      if (week.length > 0) {
        while (week.length < 7) week.push(null);
        weeks.push(week);
      }
      return { year, weeks };
    });
}

/** The sport families the load scatter and the weekly hours colour, in legend order. */
export const SPORT_FAMILIES = ['ride', 'run', 'swim', 'walk', 'other'] as const;
export type SportFamily = (typeof SPORT_FAMILIES)[number];

/** The family a sport type belongs to; the page's `--sport-*` variables are keyed by it. */
export function sportFamily(sportType: string): SportFamily {
  const sport = sportType.toLowerCase();
  if (/ride|cycl|bike/.test(sport)) return 'ride';
  if (/run/.test(sport)) return 'run';
  if (/swim/.test(sport)) return 'swim';
  if (/walk|hike/.test(sport)) return 'walk';
  return 'other';
}

/** The family's colour variable. */
export const sportColour = (family: SportFamily) => `var(--sport-${family})`;

type FormDay = { ctl: number | null; atl: number | null };

/** Form: fitness less fatigue, null on a day missing either. */
export const formOf = (day: FormDay): number | null =>
  day.ctl === null || day.atl === null ? null : day.ctl - day.atl;

/** Where the form zones change, on the intervals.icu form boundaries, lowest first. */
const FORM_ZONE_EDGES = [-30, -10, 5, 25] as const;
const FORM_ZONES = ['highRisk', 'optimal', 'greyZone', 'fresh', 'transition'] as const;
export type FormZone = (typeof FORM_ZONES)[number];

/** The form zones a range reaches, each clipped to it, lowest first. */
export function formZoneBands(
  low: number,
  high: number
): { zone: FormZone; from: number; to: number }[] {
  if (!(high > low)) return [];
  const edges = [-Infinity, ...FORM_ZONE_EDGES, Infinity];
  return FORM_ZONES.flatMap((zone, i) => {
    const from = Math.max(low, edges[i] ?? -Infinity);
    const to = Math.min(high, edges[i + 1] ?? Infinity);
    return to > from ? [{ zone, from, to }] : [];
  });
}

/**
 * An axis label for each `YYYY-MM-DD` day: the month's short name on the first
 * day shown of each month, null on the others so the axis labels months and
 * not every date.
 */
export function monthTickLabels(days: readonly string[], locale: string): (string | null)[] {
  let last = '';
  return days.map((day) => {
    const month = day.slice(0, 7);
    if (month === last) return null;
    last = month;
    return new Date(`${month}-01T12:00:00Z`).toLocaleDateString(locale, {
      month: 'short',
      timeZone: 'UTC',
    });
  });
}

/** The ride each span's decoupling was read from, spans without one left out. */
export function decouplingRows(
  spans: readonly Methods['fitness.screen']['result']['decouplingSources'][number][]
) {
  return spans.flatMap(({ days, source }) =>
    source
      ? [
          {
            days,
            activityId: source.activityId,
            name: source.name,
            date: source.startDateLocal.slice(0, 10),
            decoupling: Math.round(source.decoupling * 10) / 10,
          },
        ]
      : []
  );
}

/** The fitness page's tabs, in the order the tab row shows them. */
export const FITNESS_TABS = ['overview', 'calendar', 'performance', 'trends'] as const;
export type FitnessTab = (typeof FITNESS_TABS)[number];

/** The tab an address names; the first when it names none or an unknown one. */
export function fitnessTabFor(route: Route): FitnessTab {
  const tab = queryValue(route, 'tab');
  return (FITNESS_TABS as readonly string[]).includes(tab ?? '')
    ? (tab as FitnessTab)
    : FITNESS_TABS[0];
}

export type WellnessDay = {
  date: string;
  hrv: number | null;
  restingHr: number | null;
  weight: number | null;
  sleepSecs: number | null;
};

export type WellnessLane = { key: 'hrv' | 'restingHr' | 'sleep' | 'weight'; values: number[] };

/**
 * One lane per wellness quantity, with one value per day so every lane shares
 * the fitness chart's days; a day with no value is NaN. A quantity no day holds
 * has no lane. Sleep is in hours.
 */
export function wellnessLanes(days: readonly WellnessDay[]): WellnessLane[] {
  const lane = (
    key: WellnessLane['key'],
    pick: (day: WellnessDay) => number | null
  ): WellnessLane => ({ key, values: days.map((day) => pick(day) ?? Number.NaN) });
  return [
    lane('hrv', (day) => day.hrv),
    lane('restingHr', (day) => day.restingHr),
    lane('sleep', (day) => (day.sleepSecs === null ? null : day.sleepSecs / 3600)),
    lane('weight', (day) => day.weight),
  ].filter((entry) => entry.values.some((value) => Number.isFinite(value)));
}
