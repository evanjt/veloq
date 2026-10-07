/** Signed change over the plotted window, `null` when the engine sent none. */
export function formatSignedChange(delta: number | null | undefined): string | null {
  if (delta === null || delta === undefined) return null;
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return '0';
}

export interface RisePlot {
  width: number;
  top: number;
  height: number;
  min: number;
  max: number;
}

/**
 * Where each day the engine marked as a rise sits on the fitness line: evenly
 * spaced across the width, the value mapped through the plot's own domain.
 */
export function riseDayPoints(
  series: number[],
  riseDays: number[],
  plot: RisePlot
): { x: number; y: number }[] {
  const last = series.length - 1;
  const span = plot.max - plot.min;
  const points: { x: number; y: number }[] = [];
  for (const i of riseDays) {
    const value = series[i];
    if (value === undefined) continue;
    points.push({
      x: (i / last) * plot.width,
      y: plot.top + plot.height * (1 - (value - plot.min) / span),
    });
  }
  return points;
}
