// What the fitness and insights dashboards lay out. No browser API, so a test
// drives it. The numbers shown are the engine's: this file only chooses which
// rows go where and how they are ordered.

import { RANGES } from './fitness';
import type { Route } from './router';
import { queryValue } from './router';
import type { Methods } from './schema';

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

export type MonthColumn = 'count' | 'load' | 'distance' | 'duration';

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
  const sign = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, at) => ({ row, at }))
    .sort((a, b) => {
      const x = a.row[column] ?? null;
      const y = b.row[column] ?? null;
      if (x === null || y === null) return x === y ? a.at - b.at : x === null ? 1 : -1;
      return x === y ? a.at - b.at : (x - y) * sign;
    })
    .map(({ row }) => row);
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
