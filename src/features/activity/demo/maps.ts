import {
  demoRoutes,
  getRouteBounds,
  getRouteCoordinates,
  getRouteCoordinatesWithVariation,
} from '@/features/routes/demo/routes';
import { createActivitySeededRandom } from '@/data/demo/random';

import type { ApiActivity, ApiActivityMap } from './types';
import { getActivity } from './activities';

export function getActivityMap(id: string, boundsOnly = false): ApiActivityMap | null {
  const activity = getActivity(id) as ApiActivity & { _routeId?: string };
  if (!activity) return null;

  // Pool swims don't have maps, but open water swims with routes do
  const routeId = activity._routeId;
  if (activity.type === 'Swim' && !routeId) {
    return null;
  }

  // Virtual rides now have real GPS routes, check routeId
  if (activity.type === 'VirtualRide' && !routeId) {
    return null;
  }

  // Get route coordinates
  const route = routeId ? demoRoutes.find((r) => r.id === routeId) : null;

  if (route && routeId) {
    const isStable = id.startsWith('demo-test-') || id.startsWith('demo-stress-');
    const coords = isStable
      ? getRouteCoordinates(routeId)
      : getRouteCoordinatesWithVariation(routeId, createActivitySeededRandom(id + '-gps'));
    const bounds = getRouteBounds(coords);
    return {
      bounds,
      latlngs: boundsOnly ? null : coords,
      route: null,
      weather: null,
    };
  }

  // Fallback: generate simple circular route around demo location (Sydney)
  const coords: [number, number][] = [];
  const baseLat = -33.89;
  const baseLng = 151.2;
  const points = 50;
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    coords.push([baseLat + Math.sin(angle) * 0.01, baseLng + Math.cos(angle) * 0.01]);
  }
  coords.push(coords[0]); // Close loop

  return {
    bounds: getRouteBounds(coords),
    latlngs: boundsOnly ? null : coords,
    route: null,
    weather: null,
  };
}
