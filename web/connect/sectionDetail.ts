// What the section page shows of the engine's performance read, placed for the
// charts and tables: the ask for a sport and a range, the points of one
// direction, the engine's histogram bins, the stats of each direction and each
// lap's delta curve. The engine computes every figure; this only selects and
// lays out what it answered. Pure, so a test drives it without a browser.

import { floatsOf } from './link';
import type { Methods } from './schema';

export type Performance = Methods['section.performance']['result'];
export type Detail = Methods['section.detail']['result'];

export type RangeId = '90d' | '1y' | 'all';

/** The ranges the page offers, each in days; `all` is longer than any library. */
export const RANGES: readonly { id: RangeId; days: number }[] = [
  { id: '90d', days: 90 },
  { id: '1y', days: 365 },
  { id: 'all', days: 36_500 },
];

export const OPENING_RANGE: RangeId = '1y';

export const isRange = (value: string | null): value is RangeId =>
  RANGES.some((range) => range.id === value);

/** The ask of `section.performance` for a range and a sport; no sport lets the engine choose. */
export function askOf(id: string, range: RangeId, sport: string | null) {
  const days = RANGES.find((candidate) => candidate.id === range)?.days ?? 365;
  return { id, timeRangeDays: days, sportFilter: sport, highlightActivityId: null };
}

export type Direction = 'forward' | 'reverse';

const forward = (direction: string) => direction !== 'reverse';

/** The directions the section was ridden in: forward always, reverse once a reverse run exists. */
export function directionsOf(performance: Performance): Direction[] {
  return performance.chartData.hasReverseRuns ? ['forward', 'reverse'] : ['forward'];
}

export type ScatterPoint = {
  lapId: string;
  activityId: string;
  name: string;
  /** Unix seconds. */
  date: number;
  /** Metres per second. */
  speed: number;
  seconds: number;
  best: boolean;
  gapSeconds: number | null;
};

/** The counted laps of one direction, oldest first. */
export function pointsOf(performance: Performance, direction: Direction): ScatterPoint[] {
  return performance.chartData.points
    .filter((point) => forward(point.direction) === (direction === 'forward'))
    .map((point) => ({
      lapId: point.lapId,
      activityId: point.activityId,
      name: point.activityName,
      date: point.activityDate,
      speed: point.speed,
      seconds: point.sectionTime,
      best: point.isBest,
      gapSeconds: point.recordGapSecs,
    }))
    .sort((a, b) => a.date - b.date);
}

export type Bin = { low: number; high: number; count: number };

/** The engine's speed trend band over a direction's counted attempts; none when it answered none. */
export function trendSpeedOf(performance: Performance, direction: Direction) {
  return performance.trendCurves[direction === 'forward' ? 'forwardSpeed' : 'reverseSpeed'];
}

/** The engine's histogram of section times for one direction, as bins; none when it has none. */
export function binsOf(performance: Performance, direction: Direction): Bin[] {
  const histogram = performance.histograms[direction];
  if (!histogram) return [];
  return histogram.counts.map((count, at) => ({
    low: histogram.startSecs + at * histogram.binWidthSecs,
    high: histogram.startSecs + (at + 1) * histogram.binWidthSecs,
    count,
  }));
}

export type DirectionStats = {
  direction: Direction;
  count: number;
  avgTime: number | null;
  avgSpeed: number | null;
  /** Unix seconds of the latest lap. */
  last: number | null;
  /** The best lap time in the range. */
  best: number | null;
  /** The best is the record over the whole included history. */
  record: boolean;
  outsideBand: number;
};

/** The stats of each direction that has laps in the range. */
export function statsOf(performance: Performance): DirectionStats[] {
  const { performances } = performance;
  const rows: [Direction, typeof performances.forwardStats, number | null, boolean][] = [
    [
      'forward',
      performances.forwardStats,
      performances.bestForwardRecord?.bestForwardTime ?? null,
      performance.bestForwardIsRecord,
    ],
    [
      'reverse',
      performances.reverseStats,
      performances.bestReverseRecord?.bestReverseTime ?? null,
      performance.bestReverseIsRecord,
    ],
  ];
  return rows.flatMap(([direction, stats, best, record]) =>
    stats
      ? [
          {
            direction,
            count: stats.count,
            avgTime: stats.avgTime,
            avgSpeed: stats.avgSpeed,
            last: stats.lastActivity,
            best,
            record,
            outsideBand: stats.outsideBandCount,
          },
        ]
      : []
  );
}

export type DeltaCurve = {
  /** The lap's key, as the laps table keys its rows: the activity and where the lap starts. */
  key: string;
  date: number;
  /** Seconds behind (positive) or ahead of (negative) the reference at each grid point; null outside the lap. */
  values: (number | null)[];
};

export type DeltaCurves = {
  /** Metres from the start at each grid point. */
  metres: number[];
  curves: DeltaCurve[];
};

/** Every lap's time lost or won against the reference along the section, for one direction. */
export function deltaCurvesOf(performance: Performance, direction: Direction): DeltaCurves | null {
  const set = performance.curves?.[direction];
  if (!set || set.laps.length === 0) return null;
  const step = performance.curves?.gridStepM ?? 0;
  const curves = set.laps
    .map((lap) => ({
      key: `${lap.activityId}:${lap.startIndex}`,
      date: lap.activityDate,
      values: Array.from(floatsOf(lap.deltaSecs), (value) =>
        Number.isFinite(value) ? value : null
      ),
    }))
    .sort((a, b) => a.date - b.date);
  const length = Math.max(...curves.map((curve) => curve.values.length));
  return { metres: Array.from({ length }, (_, at) => at * step), curves };
}

export type Candidate = Detail['mergeCandidates'][number];

/** Merge candidates by how much of their ground the section shares, most first. */
export const candidatesByOverlap = (candidates: readonly Candidate[]): Candidate[] =>
  [...candidates].sort((a, b) => b.overlapPct - a.overlapPct);
