// What the routes and sections pages draw of a selected row beyond its facts:
// the performance chart's points, the attempts table's order and the history
// ledger's rows. Pure, so a test drives it without a browser. The engine
// computes every figure; this only places and orders what it answered.

import type { Methods } from './schema';

export type Performance = Methods['section.performance']['result'];
export type ChartPoint = Performance['chartData']['points'][number];
export type History = Methods['section.history']['result'];

/**
 * The slot of each read of a list's detail pane. A read asked in a slot
 * withdraws the one still outstanding there, so selecting another row cancels
 * the first row's reads. Each read has its own slot, so one read does not
 * withdraw its sibling.
 */
export const ROUTE_SLOTS = {
  routes: 'routes.list',
  routeDetail: 'routes.routeDetail',
  routePerformance: 'routes.routePerformance',
  routeAttempts: 'routes.routeAttempts',
  sectionDetail: 'routes.sectionDetail',
  sectionPerformance: 'routes.sectionPerformance',
  sectionHistory: 'routes.sectionHistory',
} as const;

/** Days of history the performance chart opens over. */
export const RANGE_DAYS = 365;

/** The ask of `route.performance` and `section.performance`. */
export function performanceAsk(id: string, timeRangeDays: number) {
  return { id, timeRangeDays, sportFilter: null, highlightActivityId: null };
}

export type PlotPoint = { id: string; name: string; x: number; y: number; best: boolean };

/**
 * The performance chart's points in a `width` by `height` plot: date across,
 * speed up. A point with no finite speed is skipped. With one date or one speed
 * the points sit mid-plot rather than on an edge.
 */
export function chartPointsOf(
  points: readonly Pick<
    ChartPoint,
    'activityId' | 'activityName' | 'activityDate' | 'speed' | 'isBest'
  >[],
  width: number,
  height: number
): PlotPoint[] {
  const drawn = points.filter((p) => Number.isFinite(p.speed) && Number.isFinite(p.activityDate));
  if (drawn.length === 0) return [];
  const dates = drawn.map((p) => p.activityDate);
  const speeds = drawn.map((p) => p.speed);
  const [d0, d1] = [Math.min(...dates), Math.max(...dates)];
  const [s0, s1] = [Math.min(...speeds), Math.max(...speeds)];
  const place = (value: number, low: number, high: number, extent: number) =>
    high === low ? extent / 2 : ((value - low) / (high - low)) * extent;
  return drawn.map((p) => ({
    id: p.activityId,
    name: p.activityName,
    x: place(p.activityDate, d0, d1, width),
    y: height - place(p.speed, s0, s1, height),
    best: p.isBest,
  }));
}

export type Attempt = {
  activityId: string;
  name: string;
  /** Epoch seconds. */
  date: number;
  /** Metres per second. */
  speed: number;
  /** Seconds. */
  movingTime: number;
  isBest: boolean;
};

export const ATTEMPT_COLUMNS = ['date', 'time', 'speed'] as const;
export type AttemptColumn = (typeof ATTEMPT_COLUMNS)[number];
export type AttemptOrder = { column: AttemptColumn; descending: boolean };

/** The table's rows ordered as asked, ties by date; the input is left as it was. */
export function attemptsOf(rows: readonly Attempt[], order: AttemptOrder): Attempt[] {
  const key = (row: Attempt) =>
    order.column === 'date' ? row.date : order.column === 'time' ? row.movingTime : row.speed;
  const sign = order.descending ? -1 : 1;
  return [...rows].sort((a, b) => sign * (key(a) - key(b)) || a.date - b.date);
}

/** Press a column head: the same column reverses, a new one opens in its natural order. */
export function pressedAttempts(order: AttemptOrder, column: AttemptColumn): AttemptOrder {
  return order.column === column
    ? { column, descending: !order.descending }
    : { column, descending: column !== 'time' };
}

export type HistoryRow = {
  id: number;
  at: string;
  kind: string;
  version: number | null;
  pinned: boolean;
  /** Names of the activities the entry's chips draw; an id with no name is kept as it is. */
  activities: string[];
};

/**
 * The ledger's rows, oldest first. A row's geometry version is pinned when the
 * ledger says that version is the one the section follows.
 */
export function historyRowsOf(history: History): HistoryRow[] {
  const names = new Map(history.names.map((n) => [n.activityId, n.name]));
  return [...history.history]
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
    .map((event) => ({
      id: event.id,
      at: event.at,
      kind: event.kind,
      version: event.geometryVersion,
      pinned: event.geometryVersion !== null && event.geometryVersion === history.pinnedVersion,
      activities: (event.details?.around ?? []).map((id) => names.get(id) ?? id),
    }));
}
