/**
 * A stand-in for the engine's training screen read, assembled from one fixture
 * per part, each asked over the window the read names for it. A suite keeps
 * its per-part fixture and asserts on it, while the cards make the one call.
 *
 *   const heatmapDays = jest.fn(() => [{ date: today, intensity: 3, ... }]);
 *   const engine = { getTrainingScreenData: trainingScreenRead({ heatmap: heatmapDays }) };
 */
import type { HeatmapDay, MonthlyStats, PeriodStats, TrainingScreenWindows } from 'veloqrs';

interface Parts {
  heatmap?: (firstDay: string, lastDay: string) => HeatmapDay[];
  months?: (startTs: number, endTs: number) => MonthlyStats[];
  period?: (startTs: number, endTs: number) => PeriodStats;
}

const NO_TOTALS: PeriodStats = { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 };

export function trainingScreenRead(parts: Parts) {
  const totals = (range: { startTs: number; endTs: number }) =>
    parts.period?.(range.startTs, range.endTs) ?? NO_TOTALS;
  return jest.fn((w: TrainingScreenWindows) => ({
    heatmap: parts.heatmap?.(w.heatmapFirstDay, w.heatmapLastDay) ?? [],
    months: parts.months?.(w.months.startTs, w.months.endTs) ?? [],
    yearCurrent: totals(w.yearCurrent),
    yearPrevious: totals(w.yearPrevious),
    monthCurrent: totals(w.monthCurrent),
    monthPrevious: totals(w.monthPrevious),
  }));
}
