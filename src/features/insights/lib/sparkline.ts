import type { HistoryMark, HistorySeries, InsightHistory, SeriesPoint } from '../types';

type SeriesKind = 'timeline' | 'sparkline' | 'bars';

/**
 * The values at the top and bottom edge of a history's drawing. A timeline is
 * section times, where less is faster, so its fastest effort is at the top.
 * Bars stand on zero, so zero is inside the range whatever the weeks hold.
 */
export function historyRange(kind: SeriesKind, values: number[]): { top: number; bottom: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (kind === 'bars') return { top: Math.max(0, max), bottom: Math.min(0, min) };
  return kind === 'timeline' ? { top: min, bottom: max } : { top: max, bottom: min };
}

interface SparklineOptions {
  kind?: SeriesKind;
  mark?: HistoryMark | undefined;
  /** Prints a value in the series' unit, for the sheet's ticks and readout. */
  format?: (value: number) => string;
  /** The series' unit symbol, for a card that prints its values one at a time. */
  unit?: string;
}

/**
 * The fewest dated points an insight carries as a history. Fewer draw a shape
 * the data does not have, so the row draws no trend and the sheet leads with
 * the figure alone.
 */
export const HISTORY_MIN_POINTS = 6;

/** A dated graphic from the engine series, when enough points exist to draw one. */
export function sparkline(
  points: SeriesPoint[] | undefined,
  label: string,
  target: string,
  { kind = 'sparkline', mark, format, unit }: SparklineOptions = {}
): { history?: InsightHistory; dataTarget: string } {
  if (!points || points.length < HISTORY_MIN_POINTS) return { dataTarget: target };
  const series: HistorySeries[] = [
    { label, points, ...(unit ? { unit } : {}), ...(format ? { format } : {}) },
  ];
  return {
    history: {
      kind,
      series,
      ...(mark ? { mark } : {}),
      target,
    },
    dataTarget: target,
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
