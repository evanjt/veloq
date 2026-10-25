import { featureCollection, lineFeature, lngLatFromShort } from '@/features/maps';
import type { LatLngShort } from '@/shared/geo/distance';

/** The layer a tap on a nearby route is answered by. */
export const NEARBY_ROUTE_HIT_LAYER = 'nearby-routes-hit';

interface DrawnRoute {
  id: string;
  points: LatLngShort[];
}

/**
 * The nearby routes the athlete is not following, one line each carrying its route id, so the
 * followed route is drawn once in its own colour and never twice.
 */
export function unfollowedRouteLines(routes: readonly DrawnRoute[], followedId: string | null) {
  return featureCollection(
    routes
      .filter((route) => route.id !== followedId)
      .map((route) => lineFeature(lngLatFromShort(route.points), { routeId: route.id }))
  );
}

/** The followed route's line, empty while nothing is followed. */
export function followedRouteLine(routes: readonly DrawnRoute[], followedId: string | null) {
  const followed = followedId ? routes.find((route) => route.id === followedId) : undefined;
  return featureCollection([lineFeature(followed ? lngLatFromShort(followed.points) : [])]);
}

/** The route id under a map tap, null when the tap hit no nearby route. */
export function routeIdUnderPress(
  feature: { properties: Record<string, unknown> } | null
): string | null {
  if (!feature) return null;
  const id = feature.properties.routeId;
  return typeof id === 'string' ? id : null;
}
