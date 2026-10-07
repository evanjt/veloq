/**
 * The route-line layer the map read returns, as the GeoJSON collection the map draws.
 *
 * The engine pre-builds the lines and stamps them with the route group generation they
 * came from. The cache keeps the collection it decoded while the generation is
 * unchanged, so a filter change that re-reads the map hands MapLibre the same object
 * rather than a new one to diff.
 */
import { decodeCoordsFlat } from 'veloqrs/src/coords';
import { routePalette } from '@/theme';
import { EMPTY_FEATURE_COLLECTION } from './coordinates';

export interface RouteLineInput {
  routeId: string;
  routeNumber?: number | undefined;
  polyline: ArrayBuffer;
}

export interface RouteLineLayerInput {
  generation: number;
  routes: RouteLineInput[];
}

function buildCollection(layer: RouteLineLayerInput): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const route of layer.routes) {
    const flat = decodeCoordsFlat(route.polyline);
    const coordinates: number[][] = [];
    for (let at = 0; at + 1 < flat.length; at += 2) {
      const lat = flat[at];
      const lng = flat[at + 1];
      // A non-finite pair in a LineString crashes the iOS renderer.
      if (lat === undefined || lng === undefined) continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      coordinates.push([lng, lat]);
    }
    // One point is not a line, and the renderer crashes on it.
    if (coordinates.length < 2) continue;
    features.push({
      type: 'Feature',
      id: route.routeId,
      properties: {
        id: route.routeId,
        number: route.routeNumber ?? null,
        color: routePalette[features.length % routePalette.length],
      },
      geometry: { type: 'LineString', coordinates },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function createRouteLineCache() {
  let generation: number | null = null;
  let held: GeoJSON.FeatureCollection = EMPTY_FEATURE_COLLECTION;
  return {
    collection(layer: RouteLineLayerInput | undefined): GeoJSON.FeatureCollection {
      if (!layer) {
        generation = null;
        held = EMPTY_FEATURE_COLLECTION;
        return held;
      }
      if (generation !== layer.generation) {
        held = buildCollection(layer);
        generation = layer.generation;
      }
      return held;
    },
  };
}
