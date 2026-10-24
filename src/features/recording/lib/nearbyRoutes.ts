export const NEARBY_ROUTE_RADIUS_METRES = 2000;

const METRES_PER_DEGREE = 111_320;

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface LocatedGroup {
  id: string;
  bounds: Bounds | null;
}

/**
 * The ids of the routes whose bounding box lies within the nearby radius of the location,
 * nearest first. A box that contains the location is at distance zero. A route with no bounds,
 * or no location to compare with, is left out.
 */
export function nearbyRouteIds(
  groups: readonly LocatedGroup[],
  location: { latitude: number; longitude: number } | null
): string[] {
  if (!location) return [];
  const metresPerLngDegree = METRES_PER_DEGREE * Math.cos((location.latitude * Math.PI) / 180);
  const near: { id: string; distance: number }[] = [];
  for (const { id, bounds } of groups) {
    if (!bounds) continue;
    const dLat = Math.max(bounds.minLat - location.latitude, 0, location.latitude - bounds.maxLat);
    const dLng = Math.max(
      bounds.minLng - location.longitude,
      0,
      location.longitude - bounds.maxLng
    );
    const distance = Math.hypot(dLat * METRES_PER_DEGREE, dLng * metresPerLngDegree);
    if (distance <= NEARBY_ROUTE_RADIUS_METRES) near.push({ id, distance });
  }
  return near.sort((a, b) => a.distance - b.distance).map((n) => n.id);
}
