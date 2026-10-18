import type { XY } from '@/shared/charts/svgPath';
import type { FormZone } from './fitness';

/** A zone band in plot pixels, clipped to the plot. */
export interface ZoneBandPx {
  zone: FormZone;
  top: number;
  bottom: number;
}

/** Where a zone's name sits: the top left of its label box. */
export interface ZoneLabelSpot {
  zone: FormZone;
  x: number;
  y: number;
}

/** Whether any part of the line passes through the box. */
function lineCrosses(
  runs: readonly (readonly XY[])[],
  x0: number,
  x1: number,
  y0: number,
  y1: number
): boolean {
  for (const run of runs) {
    const [only] = run;
    if (run.length === 1 && only) {
      if (only.x >= x0 && only.x <= x1 && only.y >= y0 && only.y <= y1) return true;
      continue;
    }
    for (let i = 1; i < run.length; i++) {
      const p = run[i - 1];
      const q = run[i];
      if (!p || !q) continue;
      const left = Math.max(Math.min(p.x, q.x), x0);
      const right = Math.min(Math.max(p.x, q.x), x1);
      if (left > right) continue;
      const yAt = (x: number) =>
        q.x === p.x ? p.y : p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y);
      const ya = q.x === p.x ? Math.min(p.y, q.y) : yAt(left);
      const yb = q.x === p.x ? Math.max(p.y, q.y) : yAt(right);
      if (Math.max(ya, yb) >= y0 && Math.min(ya, yb) <= y1) return true;
    }
  }
  return false;
}

/**
 * Each zone's name inside its band, on the band's centre row: at the left end
 * when the form line leaves that clear, else at the right end. A band shorter
 * than a label, or with neither end clear, goes unnamed and the readout names
 * the zone instead.
 */
export function zoneLabelSpots(
  bands: readonly ZoneBandPx[],
  line: readonly (readonly XY[])[],
  plot: { left: number; right: number },
  sizeOf: (zone: FormZone) => { width: number; height: number },
  inset: number
): ZoneLabelSpot[] {
  const spots: ZoneLabelSpot[] = [];
  for (const band of bands) {
    const { width, height } = sizeOf(band.zone);
    if (band.bottom - band.top < height) continue;
    if (plot.right - plot.left < width + 2 * inset) continue;
    const y = (band.top + band.bottom) / 2 - height / 2;
    const ends = [plot.left + inset, plot.right - inset - width];
    const x = ends.find((left) => !lineCrosses(line, left, left + width, y, y + height));
    if (x !== undefined) spots.push({ zone: band.zone, x, y });
  }
  return spots;
}
