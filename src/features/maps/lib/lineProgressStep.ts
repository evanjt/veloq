/**
 * The `step` over `line-progress` that a line gradient is built from. MapLibre's
 * `step` parser rejects an expression with fewer than four arguments, so a line
 * that holds one colour from start to end takes a stop at the end of the line
 * that repeats that colour.
 */

/**
 * A `step` over `line-progress` that is `first` up to the first stop, then each
 * `[stop, colour]` pair of `stops` in turn. Empty `stops` give `first` for the
 * whole line.
 */
export function lineProgressStep(first: unknown, stops: readonly unknown[]): unknown[] {
  return ['step', ['line-progress'], first, ...(stops.length > 0 ? stops : [1, first])];
}
