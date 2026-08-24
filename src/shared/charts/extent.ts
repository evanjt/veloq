/**
 * Min/max over a numeric stream.
 *
 * Streams reach full sample resolution, so `Math.max(...values)` both risks
 * exceeding the argument limit and returns Infinity on an empty array, which
 * then propagates NaN into chart coordinates. This loops and reports the
 * empty case instead.
 */
export type Extent = { min: number; max: number };

export function finiteExtent(values: ArrayLike<number>): Extent | null {
  let min = Infinity;
  let max = -Infinity;
  let seen = false;

  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    seen = true;
  }

  return seen ? { min, max } : null;
}
