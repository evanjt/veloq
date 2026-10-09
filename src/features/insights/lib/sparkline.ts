import type {
  HistoryMark,
  HistoryScale,
  HistorySeries,
  InsightHistory,
  SeriesPoint,
} from '../types';

type SeriesKind = 'timeline' | 'sparkline' | 'bars';

/**
 * The values at the top and bottom edge of a card's drawing. A timeline is
 * section times, where less is faster, so its fastest effort is at the top.
 * Bars stand on zero, so zero is inside the range whatever the weeks hold.
 */
export function historyRange(kind: SeriesKind, values: number[]): { top: number; bottom: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (kind === 'bars') return { top: Math.max(0, max), bottom: Math.min(0, min) };
  return kind === 'timeline' ? { top: min, bottom: max } : { top: max, bottom: min };
}

/** The drawing's top and bottom values, printed with the series' own formatter. */
export function historyScale(
  kind: SeriesKind,
  series: HistorySeries[],
  format: (value: number) => string
): HistoryScale {
  const range = historyRange(
    kind,
    series.flatMap((s) => s.points.map((point) => point.value))
  );
  return { top: format(range.top), bottom: format(range.bottom) };
}

interface SparklineOptions {
  kind?: SeriesKind;
  mark?: HistoryMark | undefined;
  /** Prints a value in the series' unit; without one the card prints no scale. */
  format?: (value: number) => string;
}

/** A dated graphic from the engine series, when at least three points exist. */
export function sparkline(
  points: SeriesPoint[] | undefined,
  label: string,
  target: string,
  { kind = 'sparkline', mark, format }: SparklineOptions = {}
): { history?: InsightHistory } {
  if (!points || points.length < 3) return {};
  const series = [{ label, points }];
  return {
    history: {
      kind,
      series,
      ...(mark ? { mark } : {}),
      ...(format ? { scale: historyScale(kind, series, format) } : {}),
      target,
    },
  };
}

/** The record's date only when its activity survives in the visible tail. */
export function markedActivity(
  points: SeriesPoint[] | undefined,
  activityId?: string
): HistoryMark | undefined {
  if (!activityId) return undefined;
  const best = points?.find((point) => point.activityId === activityId);
  return best ? { date: best.date } : undefined;
}
