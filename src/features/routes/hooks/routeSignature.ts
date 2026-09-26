/**
 * The simplified track the map draws a route group from.
 *
 * The hook that loaded a whole library of these is gone: the regional map drew
 * a line per activity from them, and it no longer does. What is left is the
 * record shape and its one helper, read by the route-group builders.
 */

export interface RouteSignature {
  /**
   * The track as a flat `[lat, lng, lat, lng, ...]` array, two slots per point.
   *
   * Not objects: the rebuild decodes a library at once, 58,660 points on a
   * 838-activity library, and every point that is an object is an allocation
   * the map never keeps. The consumer builds the `[lng, lat]` pairs GeoJSON
   * wants, for the points it actually draws.
   */
  points: Float64Array;
  center: { lat: number; lng: number };
}

/** How many points a flat track carries. */
export function pointCount(points: Float64Array): number {
  return points.length >> 1;
}
