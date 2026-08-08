/**
 * Coordinate normalisation for the map surfaces.
 *
 * Callers hold geometry in four different shapes. GeoJSON and MapLibre both
 * want `[lng, lat]`, so every surface converts at its edge through one of these
 * readers. Non-finite points are dropped rather than passed on, because a NaN
 * reaching the renderer produces an empty or broken layer with no error.
 */

/** GeoJSON order: longitude first. The single internal convention. */
export type LngLat = [number, number];

/** Shape used by the activity detail screen and expo-location. */
export interface LatLngObject {
  latitude: number;
  longitude: number;
}

/** Shape used by `RoutePoint`, sections and routes. */
export interface LatLngShort {
  lat: number;
  lng: number;
}

export interface LngLatBounds {
  sw: LngLat;
  ne: LngLat;
}

function isFinitePair(lng: number, lat: number): boolean {
  return Number.isFinite(lng) && Number.isFinite(lat);
}

/** Pass through `[lng, lat]` tuples, dropping non-finite entries. */
export function lngLatFromTuples(points: readonly (readonly [number, number])[]): LngLat[] {
  const out: LngLat[] = [];
  for (const [lng, lat] of points) {
    if (isFinitePair(lng, lat)) out.push([lng, lat]);
  }
  return out;
}

/** Flip `[lat, lng]` tuples, the shape recording and activity bounds use. */
export function lngLatFromLatLngTuples(points: readonly (readonly [number, number])[]): LngLat[] {
  const out: LngLat[] = [];
  for (const [lat, lng] of points) {
    if (isFinitePair(lng, lat)) out.push([lng, lat]);
  }
  return out;
}

/** Read `{ latitude, longitude }` objects. */
export function lngLatFromLatLng(points: readonly LatLngObject[]): LngLat[] {
  const out: LngLat[] = [];
  for (const point of points) {
    if (point && isFinitePair(point.longitude, point.latitude)) {
      out.push([point.longitude, point.latitude]);
    }
  }
  return out;
}

/** Read `{ lat, lng }` objects. */
export function lngLatFromShort(points: readonly LatLngShort[]): LngLat[] {
  const out: LngLat[] = [];
  for (const point of points) {
    if (point && isFinitePair(point.lng, point.lat)) {
      out.push([point.lng, point.lat]);
    }
  }
  return out;
}

/** Single `{ lat, lng }` point, or null when it is not drawable. */
export function lngLatFromShortPoint(point: LatLngShort | null | undefined): LngLat | null {
  if (!point || !isFinitePair(point.lng, point.lat)) return null;
  return [point.lng, point.lat];
}

/** Single `{ latitude, longitude }` point, or null when it is not drawable. */
export function lngLatFromLatLngPoint(point: LatLngObject | null | undefined): LngLat | null {
  if (!point || !isFinitePair(point.longitude, point.latitude)) return null;
  return [point.longitude, point.latitude];
}

/**
 * Bounding box of a normalised coordinate list, with optional fractional
 * padding. Returns null when there is nothing to fit.
 */
export function boundsOfLngLat(points: readonly LngLat[], padding = 0): LngLatBounds | null {
  if (points.length === 0) return null;

  let minLng = points[0][0];
  let maxLng = points[0][0];
  let minLat = points[0][1];
  let maxLat = points[0][1];

  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  const lngPad = (maxLng - minLng) * padding;
  const latPad = (maxLat - minLat) * padding;

  return {
    sw: [minLng - lngPad, minLat - latPad],
    ne: [maxLng + lngPad, maxLat + latPad],
  };
}

/** GeoJSON LineString feature, or null when there are fewer than two points. */
export function lineFeature(
  coordinates: readonly LngLat[],
  properties: Record<string, unknown> = {}
): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (coordinates.length < 2) return null;
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'LineString', coordinates: coordinates as LngLat[] },
  };
}

/** GeoJSON Point feature. */
export function pointFeature(
  coordinate: LngLat,
  properties: Record<string, unknown> = {}
): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Point', coordinates: coordinate },
  };
}

/** Wrap features into a FeatureCollection, skipping nulls. */
export function featureCollection(
  features: readonly (GeoJSON.Feature | null)[]
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.filter((feature): feature is GeoJSON.Feature => feature !== null),
  };
}

/** Empty collection shared by every surface so idle sources stay cheap. */
export const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};
