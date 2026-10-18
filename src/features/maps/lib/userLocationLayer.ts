/**
 * The location dot, shared by every map that draws one.
 *
 * The source stays in the spec list whether or not a fix is held. With no fix
 * it carries the one shared empty collection, which the surface patcher skips
 * unsent, and the circles are drawn at zero opacity.
 */
import type { MapPalette } from '@/theme';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { EMPTY_FEATURE_COLLECTION } from './coordinates';

export const USER_LOCATION_SOURCE_ID = 'user-location';

/** The dot's collection: one point at the fix, the empty collection with none. */
export function buildUserLocationCollection(
  userLocation: [number, number] | null
): GeoJSON.FeatureCollection {
  if (!userLocation) return EMPTY_FEATURE_COLLECTION;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { hasLocation: true },
        geometry: { type: 'Point', coordinates: userLocation },
      },
    ],
  };
}

/** The halo and the dot, keyed on whether a fix is held. */
export function buildUserLocationLayers(
  hasUserLocation: boolean,
  palette: MapPalette
): MapLayerSpec[] {
  const { layer } = palette;
  return [
    {
      id: 'user-location-outer',
      type: 'circle',
      source: USER_LOCATION_SOURCE_ID,
      paint: {
        'circle-radius': 12,
        'circle-color': layer.route,
        'circle-opacity': hasUserLocation ? 0.3 : 0,
      },
    },
    {
      id: 'user-location-inner',
      type: 'circle',
      source: USER_LOCATION_SOURCE_ID,
      paint: {
        'circle-radius': 6,
        'circle-color': layer.route,
        'circle-opacity': hasUserLocation ? 1 : 0,
        'circle-stroke-width': 2,
        'circle-stroke-color': layer.onFill,
      },
    },
  ];
}
