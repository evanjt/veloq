/**
 * The per-series accessors `ChartCanvas` projects points with.
 *
 * Built in the render body, this was a fresh object of fresh closures every
 * render, and `ChartCanvas` keys its frame memo on it. So a scrub tick, which
 * changes nothing about the data, re-ran `projectPoints` for every series and
 * missed the path memos under it, rebuilding d3 `curveNatural` and a Skia path
 * three times per series inside the gesture.
 */

import { useMemo } from 'react';

/** What the accessor map is keyed by: the series' own id. */
interface HasId {
  id: string;
}

export type SeriesAccessors = Record<string, (d: Record<string, number>) => number>;

export function useSeriesAccessors(series: readonly HasId[]): SeriesAccessors {
  return useMemo(
    () =>
      Object.fromEntries(
        series.map((s) => [s.id, (d: Record<string, number>) => d[s.id]])
      ) as SeriesAccessors,
    [series]
  );
}
