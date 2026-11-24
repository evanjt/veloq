/**
 * The two coordinate shapes the app holds, and the conversions between them.
 *
 * The engine and the decoder speak `{ latitude, longitude }`, and the section
 * records and the route screens speak `{ lat, lng }`. Each direction is written
 * once here, so a change to either shape is made in one place.
 */

import type { LatLngShort } from '@/shared/geo/distance';
import type { LatLng } from '@/shared/geo/polyline';

/** A `{ lat, lng }` point in the engine's `{ latitude, longitude }` shape. */
export function nativeCoordFromShort(point: LatLngShort): LatLng {
  return { latitude: point.lat, longitude: point.lng };
}

/** A `{ latitude, longitude }` point in the `{ lat, lng }` shape. Elevation is not carried over. */
export function shortCoordFromNative(point: LatLng): LatLngShort {
  return { lat: point.latitude, lng: point.longitude };
}

/** A decoded `{ latitude, longitude }` list in the `{ lat, lng }` shape, in order. */
export function shortCoordsFromNative(points: readonly LatLng[]): LatLngShort[] {
  return points.map(shortCoordFromNative);
}
