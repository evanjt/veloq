/**
 * Geographic distance utilities.
 * Pure functions for center computation and haversine distance.
 */

// IUGG mean earth radius. Matches the Rust geo crate's MEAN_EARTH_RADIUS, so
// distances computed either side of the FFI boundary agree.
const EARTH_RADIUS_M = 6_371_008.8;
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

/**
 * Great-circle distance between two points in meters (haversine formula).
 *
 * The single owner of this calculation on the TypeScript side. Accepts either
 * two point objects or four raw coordinates.
 */
export function haversineDistance(p1: LatLng, p2: LatLng): number;
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number;
export function haversineDistance(
  a: LatLng | number,
  b: LatLng | number,
  c?: number,
  d?: number
): number {
  const lat1 = typeof a === 'number' ? a : a.lat;
  const lng1 = typeof a === 'number' ? (b as number) : a.lng;
  const lat2 = typeof a === 'number' ? c! : (b as LatLng).lat;
  const lng2 = typeof a === 'number' ? d! : (b as LatLng).lng;

  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
