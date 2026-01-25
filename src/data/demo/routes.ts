/**
 * Demo GPS route templates
 *
 * Real GPS routes from OpenStreetMap (ODbL License)
 * Attribution: "© OpenStreetMap contributors"
 * License: https://www.openstreetmap.org/copyright
 */

import realRoutesData from './realRoutes.json';
import { getBoundsFromPoints } from '@/lib';
import { createDateSeededRandom } from './random';

export interface DemoRoute {
  id: string;
  name: string;
  type: 'Ride' | 'Run' | 'Swim' | 'Hike' | 'Walk' | 'VirtualRide';
  coordinates: [number, number][]; // [lat, lng][]
  distance: number; // meters
  elevation: number; // meters gained
  region?: string; // Geographic region
  attribution?: string; // Data source attribution
}

/**
 * Real routes from OpenStreetMap
 * These are actual GPS routes from cycling paths, running trails, etc.
 */
export const demoRoutes: DemoRoute[] = realRoutesData as DemoRoute[];

/**
 * Get a route's coordinates (exact, no variation)
 * Activities using the same route template get identical coordinates,
 * which allows route matching to correctly group them.
 */
export function getRouteCoordinates(routeId: string): [number, number][] {
  const route = demoRoutes.find((r) => r.id === routeId);
  if (!route) return [];
  return route.coordinates;
}

/**
 * Get bounds for a route
 * Input: [lat, lng][] tuples
 * Output: [[minLat, minLng], [maxLat, maxLng]]
 */
export function getRouteBounds(coords: [number, number][]): [[number, number], [number, number]] {
  // Convert [lat, lng] tuples to {lat, lng} objects for utility
  const points = coords.map(([lat, lng]) => ({ lat, lng }));
  const bounds = getBoundsFromPoints(points);

  if (!bounds) {
    // Return default bounds if no valid coordinates
    return [
      [0, 0],
      [0, 0],
    ];
  }

  // Extract from MapLibre format and convert back to [[minLat, minLng], [maxLat, maxLng]]
  const [minLng, minLat] = bounds.sw;
  const [maxLng, maxLat] = bounds.ne;

  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

/**
 * Map activity template to a route
 * @param activityType - Activity type (e.g., 'Ride', 'Run')
 * @param distance - Expected distance in meters
 * @param dateStr - Optional date string for deterministic selection
 */
export function getRouteForActivity(
  activityType: string,
  distance: number,
  dateStr?: string
): DemoRoute | null {
  // Determine which route types match this activity
  const matchingTypes: DemoRoute['type'][] = [];
  if (activityType === 'VirtualRide') {
    // Virtual rides use VirtualRide routes (real GPS data)
    matchingTypes.push('VirtualRide');
  } else if (activityType === 'Ride') {
    matchingTypes.push('Ride', 'VirtualRide'); // Outdoor rides can use virtual routes too
  } else if (activityType === 'Run' || activityType === 'TrailRun') {
    matchingTypes.push('Run');
  } else if (activityType === 'Swim' || activityType === 'OpenWaterSwim') {
    matchingTypes.push('Swim');
  } else if (activityType === 'Hike') {
    matchingTypes.push('Hike', 'Walk', 'Run'); // Hike can use Walk or Run routes too
  } else if (activityType === 'Walk') {
    matchingTypes.push('Walk', 'Hike'); // Walk can use Hike routes too
  }

  if (matchingTypes.length === 0) {
    return null;
  }

  // Match by type and approximate distance (allow wide variance for real routes)
  const routes = demoRoutes.filter((r) => {
    if (!matchingTypes.includes(r.type)) return false;
    // Allow 50% distance variance (real routes have fixed distances)
    const ratio = r.distance / distance;
    return ratio > 0.5 && ratio < 2.0;
  });

  if (routes.length === 0) {
    // Fall back to any route of the right type
    return demoRoutes.find((r) => matchingTypes.includes(r.type)) || null;
  }

  // Use deterministic selection if date provided, otherwise first match
  if (dateStr) {
    const routeRandom = createDateSeededRandom(dateStr + '-route');
    return routes[Math.floor(routeRandom() * routes.length)];
  }

  return routes[0];
}

/**
 * Get route by ID
 */
export function getRouteById(routeId: string): DemoRoute | undefined {
  return demoRoutes.find((r) => r.id === routeId);
}

/**
 * Get locality and country from a route's region
 * @returns { locality: string | null, country: string | null }
 */
export function getRouteLocation(routeId: string): {
  locality: string | null;
  country: string | null;
} {
  const route = demoRoutes.find((r) => r.id === routeId);
  if (!route?.region) {
    return { locality: null, country: null };
  }

  const parts = route.region.split(',').map((p) => p.trim());
  return {
    locality: parts[0] || null,
    country: parts[1] || null,
  };
}
