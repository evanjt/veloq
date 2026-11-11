/**
 * True when `cached` already holds `getX` of every point, in order. Compares
 * every position and allocates nothing, so a caller can run it on each layout
 * read and map only when it returns false.
 */
export function sameXCoords<P>(
  cached: readonly number[],
  points: readonly P[],
  getX: (point: P) => number
): boolean {
  if (cached.length !== points.length) return false;
  let i = 0;
  for (const point of points) {
    if (getX(point) !== cached[i]) return false;
    i++;
  }
  return true;
}
