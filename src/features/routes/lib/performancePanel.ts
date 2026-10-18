/**
 * Pure choices behind the section and route performance panel: which views
 * it offers, each named by the question it answers, and which attempt its
 * card opens on.
 */

import type { ScatterChartPoint } from './scatterData';

/** The views the panel can show. A further view is one more member and one more branch. */
export type PerformancePlotType = 'scatter' | 'histogram' | 'delta';

/** Each view is named by the question it answers, never by its chart type. */
export const PLOT_LABEL_KEYS = {
  scatter: 'sections.viewOverTime',
  histogram: 'sections.viewSpread',
  delta: 'sections.viewAheadOrBehind',
} as const satisfies Record<PerformancePlotType, string>;

/**
 * The views offered, in their fixed order. Over time always, Spread when the
 * engine has bins for the direction, Ahead or behind when it has lap curves.
 */
export function availablePlots(data: {
  histogram: boolean;
  curves: boolean;
}): PerformancePlotType[] {
  const plots: PerformancePlotType[] = ['scatter'];
  if (data.histogram) plots.push('histogram');
  if (data.curves) plots.push('delta');
  return plots;
}

/**
 * The attempt the card opens on, so it is never empty: this activity when the
 * shown attempts hold it, else the most recent counted attempt, else the most
 * recent one.
 */
export function initialAttempt(
  shown: readonly ScatterChartPoint[],
  thisActivityId: string | undefined
): ScatterChartPoint | undefined {
  if (thisActivityId !== undefined) {
    const own = shown.find((point) => point.activityId === thisActivityId);
    if (own) return own;
  }
  const latest = (points: readonly ScatterChartPoint[]) =>
    points.reduce<ScatterChartPoint | undefined>(
      (newest, point) =>
        newest === undefined || point.date.getTime() >= newest.date.getTime() ? point : newest,
      undefined
    );
  return latest(shown.filter((point) => point.isExcluded !== true)) ?? latest(shown);
}
