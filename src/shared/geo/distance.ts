/**
 * Geographic distance utilities.
 * Pure functions for center computation and haversine distance.
 */

const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Compute the center point of a bounding box. */
export function computeCenter(bounds: Bounds): LatLng {
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
  };
}

/** Great-circle distance between two points in meters (haversine formula). */
export function haversineDistance(p1: LatLng, p2: LatLng): number {
  const dLat = (p2.lat - p1.lat) * DEG_TO_RAD;
  const dLng = (p2.lng - p1.lng) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1.lat * DEG_TO_RAD) * Math.cos(p2.lat * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
