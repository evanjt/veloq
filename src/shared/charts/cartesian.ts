import type { ChartBounds } from './useChartGestures';

export interface ChartPadding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A data-space axis range. `[max, min]` is legal and flips the axis. */
export type Domain = [number, number];

export interface ProjectedPoint {
  x: number;
  y: number;
  xValue: number;
  yValue: number;
}

export function chartBoundsFor(width: number, height: number, padding: ChartPadding): ChartBounds {
  return {
    left: padding.left,
    right: Math.max(padding.left, width - padding.right),
    top: padding.top,
    bottom: Math.max(padding.top, height - padding.bottom),
  };
}

/** Whether `value` lies inside the domain, whichever way round it is written. */
export function domainContains(domain: Domain, value: number): boolean {
  const lo = Math.min(domain[0], domain[1]);
  const hi = Math.max(domain[0], domain[1]);
  return value >= lo && value <= hi;
}

/** Linear map from `domain` onto `range`. A zero-width domain maps to the range start. */
export function scaleFor(domain: Domain, range: Domain): (value: number) => number {
  const span = domain[1] - domain[0];
  if (span === 0) return () => range[0];
  return (value) => range[0] + ((value - domain[0]) / span) * (range[1] - range[0]);
}

/** Pixel y of a data value: `domain[0]` sits on the bottom edge, `domain[1]` on the top. */
export function yForValue(value: number, yDomain: Domain, bounds: ChartBounds): number {
  return scaleFor(yDomain, [bounds.bottom, bounds.top])(value);
}

/** Pixel x of a data value: `domain[0]` sits on the left edge, `domain[1]` on the right. */
export function xForValue(value: number, xDomain: Domain, bounds: ChartBounds): number {
  return scaleFor(xDomain, [bounds.left, bounds.right])(value);
}

/** `[min, max]` of the finite x values, `[0, 1]` when there are none. */
export function dataExtent<T>(data: readonly T[], x: (datum: T) => number): Domain {
  let min = Infinity;
  let max = -Infinity;
  for (const datum of data) {
    const v = x(datum);
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return [0, 1];
  return [min, max];
}

/** Project a series into pixels, dropping points whose y is not a finite number. */
export function projectPoints<T>(
  data: readonly T[],
  x: (datum: T) => number,
  y: (datum: T) => number | null | undefined,
  xDomain: Domain,
  yDomain: Domain,
  bounds: ChartBounds
): ProjectedPoint[] {
  const sx = scaleFor(xDomain, [bounds.left, bounds.right]);
  const sy = scaleFor(yDomain, [bounds.bottom, bounds.top]);
  const out: ProjectedPoint[] = [];
  for (const datum of data) {
    const xValue = x(datum);
    const yValue = y(datum);
    if (typeof yValue !== 'number' || !Number.isFinite(yValue) || !Number.isFinite(xValue)) {
      continue;
    }
    out.push({ x: sx(xValue), y: sy(yValue), xValue, yValue });
  }
  return out;
}

/** `count` horizontal rules spread evenly from the top edge to the bottom edge. */
export function gridLineYs(bounds: ChartBounds, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(bounds.top + bounds.bottom) / 2];
  const step = (bounds.bottom - bounds.top) / (count - 1);
  return Array.from({ length: count }, (_, i) => bounds.top + i * step);
}
