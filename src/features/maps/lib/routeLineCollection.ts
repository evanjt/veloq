/**
 * The route-line layer the map read returns, and what the map's `routes` source is given
 * for it.
 *
 * The engine pre-builds the lines and stamps them with the route group generation they
 * came from, and answers them as GeoJSON at a `veloq-geo` URL on the map page's origin.
 * The source names that URL, so the lines are written once in Rust and parsed in
 * MapLibre's worker rather than decoded and stringified on the JS thread. The generation
 * is the URL's revision, so a regroup is a new URL and an unchanged layer is the same one.
 */
import { EMPTY_FEATURE_COLLECTION } from './coordinates';
import { nativeGeoUrl } from './tileTransport';

export interface RouteLineInput {
  routeId: string;
  routeNumber?: number | undefined;
  /** The name the route is shown under, read with the map */
  name: string;
  activityCount: number;
  /** The representative's distance in metres, as the route list shows it */
  distanceMeters: number;
  polyline: ArrayBuffer;
}

export interface RouteLineLayerInput {
  generation: number;
  routes: RouteLineInput[];
}

/**
 * The `routes` source's data: the engine's URL for a current layer, the empty collection
 * when there is none, which is also the layer switched off.
 */
export function routeLinesSourceData(
  layer: Pick<RouteLineLayerInput, 'generation'> | undefined
): GeoJSON.FeatureCollection | string {
  if (!layer) return EMPTY_FEATURE_COLLECTION;
  return nativeGeoUrl('route-lines', 'all', layer.generation);
}
