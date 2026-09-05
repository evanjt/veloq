/**
 * Placing a value on a chart's y axis, whichever way its domain runs.
 *
 * A pace axis reads fast at the top, so its domain is `[slowest, fastest]` and
 * descends; a power axis reads high at the top and ascends. Both mean the same
 * thing by their ends: `domain[0]` is drawn at the bottom of the plot and
 * `domain[1]` at the top. Comparing against the ends in order instead is what
 * left the critical-speed line off the pace curves entirely.
 */

/** The vertical extent of a plot, in screen coordinates. */
export interface PlotBounds {
  top: number;
  bottom: number;
}

/** Whether the axis covers this value, whichever end is larger. */
export function domainContains(domain: [number, number], value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const [a, b] = domain;
  return value >= Math.min(a, b) && value <= Math.max(a, b);
}

/**
 * Where a value sits on the axis, in screen coordinates.
 *
 * A domain of zero width has no fraction to take, so the value sits at the
 * bottom rather than dividing by nothing.
 */
export function yForValue(value: number, domain: [number, number], bounds: PlotBounds): number {
  const [start, end] = domain;
  const span = end - start;
  const fraction = span === 0 ? 0 : (value - start) / span;
  return bounds.bottom - fraction * (bounds.bottom - bounds.top);
}
