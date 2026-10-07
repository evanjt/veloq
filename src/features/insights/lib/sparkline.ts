import type { HistoryMark, InsightHistory, SeriesPoint } from '../types';

/** A dated graphic from the engine series, when at least three points exist. */
export function sparkline(
  points: SeriesPoint[] | undefined,
  label: string,
  target: string,
  kind: 'timeline' | 'sparkline' | 'bars' = 'sparkline',
  mark?: HistoryMark
): { history?: InsightHistory } {
  if (!points || points.length < 3) return {};
  return { history: { kind, series: [{ label, points }], ...(mark ? { mark } : {}), target } };
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
