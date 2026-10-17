import { line, curveMonotoneX } from 'd3-shape';

/**
 * Map a numeric series to a monotoneX SVG path string, matching Victory Native's
 * CartesianChart line geometry exactly (Victory builds its line the same way:
 * d3-shape `line().curve(curveMonotoneX)` → SVG → Skia path).
 *
 * - x: index `i` → `i * width / (N-1)` (Victory padding left/right = 0).
 * - y: `domainMax` → `plotTop`, `domainMin` → `plotTop + plotHeight`
 *   (matches Victory padding top/bottom over the chart height).
 *
 * Pure (no native module) so it is unit-testable for parity. Feed the result to
 * `Skia.Path.MakeFromSVGString`. Returns null when there is nothing drawable.
 */
export function buildMonotoneSvg(
  values: number[],
  domainMin: number,
  domainMax: number,
  width: number,
  plotTop: number,
  plotHeight: number
): string | null {
  if (values.length < 2 || width <= 0) return null;
  const step = width / (values.length - 1);
  const range = domainMax - domainMin || 1;
  return (
    line<number>()
      .x((_v, i) => i * step)
      .y((v) => plotTop + (1 - (v - domainMin) / range) * plotHeight)
      .curve(curveMonotoneX)(values) ?? null
  );
}
