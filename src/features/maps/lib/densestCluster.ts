/**
 * Which activities the map's opening camera should frame.
 *
 * An athlete who has ridden on two continents should not be shown the ocean
 * between them, so the camera fits where most of their activities are rather
 * than all of them. Finding that used to compare every activity with every
 * other: 240k iterations at 490 activities, 9M at 3,000, and it ran again on
 * every period, distance and sport chip tap, on a path with a 100 ms budget.
 *
 * Two observations make it linear. Most libraries sit inside one region, and
 * then every activity is in the cluster and there is nothing to search for. The
 * rest are a handful of regions far apart, and binning centres into cells the
 * width of the search radius means only the cells next to a point can hold its
 * neighbours.
 */

/** Half-width of the cluster search, in degrees. About 200 km of latitude. */
export const CLUSTER_RADIUS_DEG = 2;

export interface Centre {
  lat: number;
  lng: number;
}

/**
 * Indices of the activities in the densest cluster, in input order.
 *
 * Every index when the whole library already fits one cluster. Otherwise the
 * fullest cell and the ring around it, which is the same region the pairwise
 * count was looking for.
 */
export function densestClusterIndices(centres: Centre[]): number[] {
  if (centres.length === 0) return [];

  const all = centres.map((_, i) => i);
  if (spans(centres) <= CLUSTER_RADIUS_DEG * 2) return all;

  const cells = new Map<string, number[]>();
  for (let i = 0; i < centres.length; i++) {
    const key = cellKey(cellOf(centres[i].lat), cellOf(centres[i].lng));
    const cell = cells.get(key);
    if (cell) cell.push(i);
    else cells.set(key, [i]);
  }

  let best: number[] = all;
  let bestCount = -1;
  for (const key of cells.keys()) {
    const [row, col] = key.split(':').map(Number);
    const neighbourhood: number[] = [];
    for (let dRow = -1; dRow <= 1; dRow++) {
      for (let dCol = -1; dCol <= 1; dCol++) {
        const cell = cells.get(cellKey(row + dRow, col + dCol));
        if (cell) neighbourhood.push(...cell);
      }
    }
    if (neighbourhood.length > bestCount) {
      bestCount = neighbourhood.length;
      best = neighbourhood;
    }
  }

  // Input order, so the caller's bounds pass reads the same activities in the
  // same sequence whichever cell won.
  return best.sort((a, b) => a - b);
}

/** The larger of the latitude and longitude spans the centres cover. */
function spans(centres: Centre[]): number {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const c of centres) {
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
  }
  return Math.max(maxLat - minLat, maxLng - minLng);
}

function cellOf(degrees: number): number {
  return Math.floor(degrees / CLUSTER_RADIUS_DEG);
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}
