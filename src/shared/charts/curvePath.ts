import { area, curveLinear, curveMonotoneX, curveNatural, line } from 'd3-shape';

import type { XY } from './svgPath';

export type CurveKind = 'natural' | 'monotone' | 'linear';

const CURVES = {
  natural: curveNatural,
  monotone: curveMonotoneX,
  linear: curveLinear,
} as const;

/** Open curve through pixel points as an SVG path, null when there is nothing to draw. */
export function curveLineSvg(points: readonly XY[], curve: CurveKind = 'natural'): string | null {
  if (points.length < 2) return null;
  return (
    line<XY>()
      .x((p) => p.x)
      .y((p) => p.y)
      .curve(CURVES[curve])(points as XY[]) ?? null
  );
}

/** Closed area between the curve and the horizontal pixel line `y0`. */
export function curveAreaSvg(
  points: readonly XY[],
  y0: number,
  curve: CurveKind = 'natural'
): string | null {
  if (points.length < 2) return null;
  return (
    area<XY>()
      .x((p) => p.x)
      .y0(() => y0)
      .y1((p) => p.y)
      .curve(CURVES[curve])(points as XY[]) ?? null
  );
}
