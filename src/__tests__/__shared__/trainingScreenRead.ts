/**
 * A stand-in for the engine's training screen read, assembled from one fixture
 * per part, each asked over the window the read names for it. A suite keeps
 * its per-part fixture and asserts on it, while the cards make the one call.
 *
 *   const heatmapDays = jest.fn(() => [{ date: today, intensity: 3, ... }]);
 *   const engine = { getTrainingScreenData: trainingScreenRead({ heatmap: heatmapDays }) };
 */
import type {
  HeatmapDay,
  MonthlyStats,
  PeriodStats,
  StatTrend,
  SummaryComparison,
  TrainingScreenData,
  TrainingScreenWindows,
} from 'veloqrs';

type Comparisons = TrainingScreenData['comparisons'];

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

export function trainingScreenRead(parts: Parts) {
  const totals = (range: { startTs: number; endTs: number }) =>
    parts.period?.(range.startTs, range.endTs) ?? NO_TOTALS;
  return jest.fn((w: TrainingScreenWindows) => {
    const now = w.nowWallSeconds;
    return {
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
