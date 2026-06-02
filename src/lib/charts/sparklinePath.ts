import { line, area, curveMonotoneX } from 'd3-shape';

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

/**
 * Closed monotoneX area path from the series down to a `baselineValue` (in data
 * units), matching Victory Native's `<Area y0={baselineValue} curveType="monotoneX">`
 * exactly (Victory uses d3-shape `area().curve(curveMonotoneX)`). Same x/y mapping
 * as `buildMonotoneSvg`. Feed to `Skia.Path.MakeFromSVGString` and fill. Returns
 * null when there is nothing drawable.
 */
export function buildMonotoneAreaSvg(
  values: number[],
  domainMin: number,
  domainMax: number,
  width: number,
  plotTop: number,
  plotHeight: number,
  baselineValue: number
): string | null {
  if (values.length < 2 || width <= 0) return null;
  const step = width / (values.length - 1);
  const range = domainMax - domainMin || 1;
  const y = (v: number) => plotTop + (1 - (v - domainMin) / range) * plotHeight;
  return (
    area<number>()
      .x((_v, i) => i * step)
      .y0(() => y(baselineValue))
      .y1((v) => y(v))
      .curve(curveMonotoneX)(values) ?? null
  );
}
