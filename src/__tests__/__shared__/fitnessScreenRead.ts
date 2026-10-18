/**
 * A stand-in for the engine's fitness screen read, its calendar parts
 * assembled from one fixture per part, each asked over the window the read
 * names for it, and its trend, speeds and strip empty. A suite keeps its
 * per-part fixture and asserts on it, while the screen makes the one call.
 *
 *   const heatmapDays = jest.fn(() => [{ date: today, intensity: 3, ... }]);
 *   const engine = { getFitnessScreenData: fitnessScreenRead({ heatmap: heatmapDays }) };
 */
import {
  RangeCoverage,
  type FitnessScreenData,
  type FitnessScreenWindows,
  type HeatmapDay,
  type MonthlyStats,
  type PeriodStats,
  type StatTrend,
  type SummaryComparison,
} from 'veloqrs';

type Comparisons = FitnessScreenData['comparisons'];

interface Parts {
  heatmap?: (firstDay: string, lastDay: string) => HeatmapDay[];
  months?: (startTs: number, endTs: number) => MonthlyStats[];
  period?: (startTs: number, endTs: number) => PeriodStats;
  /** The weekly card's ranges, given the instant the read runs to. */
  comparisons?: (nowWallSeconds: number) => Partial<Comparisons>;
}

export const NO_TOTALS: PeriodStats = {
  count: 0,
  totalDuration: 0,
  totalDistance: 0,
  totalTss: 0,
};

/** Midnight of a local date, in the engine's wall-clock seconds. */
export function wallSeconds(date: Date): number {
  return Math.floor(
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

/** One comparison, every window and total defaulted to an empty one at `now`. */
export function summaryComparison(
  now: number,
  part: Partial<SummaryComparison> & { moves?: Partial<Record<string, StatTrend>> } = {}
): SummaryComparison {
  const { moves, ...rest } = part;
  return {
    current: { startTs: now, endTs: now },
    previous: { startTs: now, endTs: now },
    currentStats: NO_TOTALS,
    previousStats: NO_TOTALS,
    ...(moves?.count && { count: moves.count }),
    ...(moves?.duration && { duration: moves.duration }),
    ...(moves?.distance && { distance: moves.distance }),
    ...(moves?.load && { load: moves.load }),
    ...rest,
  };
}

/** The weekly card's every range with nothing in it, at `now`. */
export function noComparisons(now: number): Comparisons {
  const empty = summaryComparison(now);
  return { week: empty, month: empty, threeMonths: empty, sixMonths: empty, year: empty };
}

/** The calendar parts with nothing in them, the weekly card's ranges at `now`. */
export function noCalendarParts(now = 0) {
  return {
    heatmap: [],
    months: [],
    yearCurrent: NO_TOTALS,
    yearPrevious: NO_TOTALS,
    monthCurrent: NO_TOTALS,
    monthPrevious: NO_TOTALS,
    comparisons: noComparisons(now),
  };
}

const NO_PACE = { sampleCount: 0, history: [] };

/** The parts the calendar cards do not paint, with nothing in them. */
export const NO_FITNESS_PARTS = {
  ftpTrend: { lookbackDays: 0, sampleCount: 0, history: [], changes: [] },
  ftpTrendCoverage: RangeCoverage.NotFetched,
  runPaceTrend: NO_PACE,
  swimPaceTrend: NO_PACE,
  sportMix: { rides: 0, runs: 0, swims: 0 },
  fitnessDays: 42,
  fatigueDays: 7,
  decouplingSources: [],
  loadDots: [],
};

export function fitnessScreenRead(parts: Parts) {
  const totals = (range: { startTs: number; endTs: number }) =>
    parts.period?.(range.startTs, range.endTs) ?? NO_TOTALS;
  return jest.fn((_spanDays: number[], w: FitnessScreenWindows): FitnessScreenData => {
    const now = w.nowWallSeconds;
    return {
      ...NO_FITNESS_PARTS,
      heatmap: parts.heatmap?.(w.heatmapFirstDay, w.heatmapLastDay) ?? [],
      months: parts.months?.(w.months.startTs, w.months.endTs) ?? [],
      yearCurrent: totals(w.yearCurrent),
      yearPrevious: totals(w.yearPrevious),
      monthCurrent: totals(w.monthCurrent),
      monthPrevious: totals(w.monthPrevious),
      comparisons: { ...noComparisons(now), ...parts.comparisons?.(now) },
    };
  });
}
