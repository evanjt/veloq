/**
 * A radius in metres as GeoJSON. MapLibre sizes its own circles in pixels, so
 * a distance on the ground has to be a polygon that scales with the map.
 */
import type { LngLat, LngLatBounds } from './coordinates';

const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;

/** Vertices on the ring. Enough that 500 m reads as round at street zoom. */
export const CIRCLE_STEPS = 64;

/** The point `eastM` and `northM` metres from `centre`, flat-earth at this scale. */
function offset(centre: LngLat, eastM: number, northM: number): LngLat {
  const [lng, lat] = centre;
  const dLat = northM / EARTH_RADIUS_M / DEG_TO_RAD;
  const dLng = eastM / (EARTH_RADIUS_M * Math.cos(lat * DEG_TO_RAD)) / DEG_TO_RAD;
  return [lng + dLng, lat + dLat];
}

/** Closed polygon of `radiusM` around `centre`, or null when there is nothing to draw. */
export function circlePolygon(
  centre: LngLat,
  radiusM: number,
  steps = CIRCLE_STEPS
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (!(radiusM > 0)) return null;
  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push(offset(centre, radiusM * Math.cos(angle), radiusM * Math.sin(angle)));
  }
  ring.push(ring[0]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/** The square that encloses the circle, for fitting a camera to it. */
export function circleBounds(centre: LngLat, radiusM: number): LngLatBounds {
  return { sw: offset(centre, -radiusM, -radiusM), ne: offset(centre, radiusM, radiusM) };
}
