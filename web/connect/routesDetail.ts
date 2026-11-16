// What the routes and sections pages draw of a selected row beyond its facts:
// the performance chart's points, the attempts table's order and the history
// ledger's rows. Pure, so a test drives it without a browser. The engine
// computes every figure; this only places and orders what it answered.

import type { CurveBandPoint } from './charts/Chart';
import { floatsOf } from './link';
import type { FfiTrendBandPoint, Methods } from './schema';

export type Performance = Methods['section.performance']['result'];
export type ChartPoint = Performance['chartData']['points'][number];
export type History = Methods['section.history']['result'];
export type RouteAttempts = Methods['route.attempts']['result'];
export type Histogram = Methods['route.attempts']['result']['histograms']['forward'];
export type Curves = NonNullable<Performance['curves']>;

/** Days of history the performance chart opens over. */
export const RANGE_DAYS = 365;

/** The ask of `route.performance` and `section.performance`. */
export function performanceAsk(id: string, timeRangeDays: number) {
  return { id, timeRangeDays, sportFilter: null, highlightActivityId: null };
}

/** The ask of `route.attempts`: every attempt, in no sport filter. */
export function attemptsAsk(id: string) {
  return { id, currentActivityId: null, sportTypeFilter: null };
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

export const ATTEMPT_COLUMNS = ['date', 'time', 'gap', 'rank', 'speed'] as const;
export type AttemptColumn = (typeof ATTEMPT_COLUMNS)[number];
export type AttemptOrder = { column: AttemptColumn; descending: boolean };

/** The table's rows ordered as asked, ties by date; the input is left as it was. */
export function attemptsOf(rows: readonly Attempt[], order: AttemptOrder): Attempt[] {
  // The gap and the rank both follow the moving time, so they order as it does.
  const key = (row: Attempt) =>
    order.column === 'date' ? row.date : order.column === 'speed' ? row.speed : row.movingTime;
  const sign = order.descending ? -1 : 1;
  return [...rows].sort((a, b) => sign * (key(a) - key(b)) || a.date - b.date);
}

/** Press a column head: the same column reverses, a new one opens in its natural order. */
export function pressedAttempts(order: AttemptOrder, column: AttemptColumn): AttemptOrder {
  return order.column === column
    ? { column, descending: !order.descending }
    : { column, descending: column === 'date' || column === 'speed' };
}

export type RankedAttempt = Attempt & {
  /** Seconds slower than the fastest attempt; 0 for it. */
  gap: number;
  /** One more than the attempts that took less time, so equal times share a place. */
  rank: number;
};

/** The rows each with its gap to the fastest and its place; the order is the one given. */
export function rankedAttempts(rows: readonly Attempt[]): RankedAttempt[] {
  const fastest = rows.reduce((best, row) => Math.min(best, row.movingTime), Infinity);
  return rows.map((row) => ({
    ...row,
    gap: row.movingTime - fastest,
    rank: 1 + rows.filter((other) => other.movingTime < row.movingTime).length,
  }));
}

export type Side = 'ahead' | 'behind' | 'level';

/** Ahead of the reference when the attempt took less time than it. */
export function sideOf(movingTime: number, referenceTime: number): Side {
  return movingTime < referenceTime ? 'ahead' : movingTime > referenceTime ? 'behind' : 'level';
}

/**
 * The time attempts are measured against: the named reference's when it is among the rows, else
 * the fastest's. Null with no rows.
 */
export function referenceTimeOf(
  rows: readonly Attempt[],
  referenceId: string | null
): number | null {
  const named = rows.find((row) => row.activityId === referenceId);
  if (named) return named.movingTime;
  return rows.length === 0 ? null : Math.min(...rows.map((row) => row.movingTime));
}

/**
 * The engine's trend band over a route's counted attempts, with each time moved to milliseconds to
 * sit on the over-time chart's date axis. Empty where the engine answered none.
 */
export function trendBandOf(points: readonly FfiTrendBandPoint[] | null): CurveBandPoint[] {
  return (points ?? []).map((point) => ({
    time: point.time * 1000,
    value: point.value,
    lower: point.lower,
    upper: point.upper,
  }));
}

export type SpreadBin = { low: number; high: number; count: number };

/** The engine's bins as ranges of seconds; none for a direction it did not bin. */
export function spreadBins(
  histogram: Pick<NonNullable<Histogram>, 'startSecs' | 'binWidthSecs' | 'counts'> | null
): SpreadBin[] {
  if (!histogram) return [];
  return histogram.counts.map((count, at) => ({
    low: histogram.startSecs + at * histogram.binWidthSecs,
    high: histogram.startSecs + (at + 1) * histogram.binWidthSecs,
    count,
  }));
}

/** The date and time of each record step, in the order the engine gave; a step with no time is skipped. */
export function recordSteps(
  steps: readonly { activityDate: number; sectionTime: number }[]
): [date: number, seconds: number][] {
  return steps
    .filter((step) => Number.isFinite(step.sectionTime) && Number.isFinite(step.activityDate))
    .map((step) => [step.activityDate, step.sectionTime]);
}

export type DeltaSeries = {
  /** Metres along the route of each grid point. */
  metres: number[];
  /** Seconds behind (positive) or ahead of (negative) the reference; null where the attempt does not reach. */
  selected: (number | null)[] | null;
  /** The typical attempt's delta; null where too few reach. */
  typical: (number | null)[] | null;
};

const finiteOrNull = (value: number) => (Number.isFinite(value) ? value : null);

/**
 * The ahead or behind lines of one direction: the selected attempt's and the typical attempt's
 * against the reference, on the engine's grid. Empty with no direction.
 */
export function deltaSeriesOf(
  direction: {
    laps: readonly { activityId: string; deltaSecs: string }[];
    typicalDeltaSecs: string | null;
  } | null,
  selectedId: string | null,
  gridStepM: number
): DeltaSeries {
  if (!direction) return { metres: [], selected: null, typical: null };
  const lap = direction.laps.find((candidate) => candidate.activityId === selectedId);
  const selected = lap ? Array.from(floatsOf(lap.deltaSecs), finiteOrNull) : null;
  const typical = direction.typicalDeltaSecs
    ? Array.from(floatsOf(direction.typicalDeltaSecs), finiteOrNull)
    : null;
  const points = Math.max(selected?.length ?? 0, typical?.length ?? 0);
  return {
    metres: Array.from({ length: points }, (_, at) => at * gridStepM),
    selected,
    typical,
  };
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
