/**
 * Demo GPS route templates
 *
 * Real GPS routes from OpenStreetMap (ODbL License)
 * Attribution: "© OpenStreetMap contributors"
 * License: https://www.openstreetmap.org/copyright
 */

import realRoutesData from './realRoutes.json';

export interface DemoRoute {
  id: string;
  name: string;
  type: 'Ride' | 'Run' | 'Swim' | 'Hike' | 'VirtualRide';
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
 * Get a route's coordinates with optional variation
 */
export function getRouteCoordinates(
  routeId: string,
  addVariation: boolean = true
): [number, number][] {
  const route = demoRoutes.find((r) => r.id === routeId);
  if (!route) return [];

  if (!addVariation) return route.coordinates;

  // Add slight variation for different "rides" on the same route
  return route.coordinates.map(([lat, lng]) => [
    lat + (Math.random() - 0.5) * 0.00005,
    lng + (Math.random() - 0.5) * 0.00005,
  ]);
}

/**
 * Get bounds for a route
 */
export function getRouteBounds(coords: [number, number][]): [[number, number], [number, number]] {
  let minLat = Infinity,
    maxLat = -Infinity;
  let minLng = Infinity,
    maxLng = -Infinity;

  for (const [lat, lng] of coords) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }

  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

/**
 * Map activity template to a route
 */
export function getRouteForActivity(activityType: string, distance: number): DemoRoute | null {
  // Determine which route types match this activity
  const matchingTypes: DemoRoute['type'][] = [];
  if (activityType === 'Ride' || activityType === 'VirtualRide') {
    matchingTypes.push('Ride');
  } else if (activityType === 'Run' || activityType === 'TrailRun') {
    matchingTypes.push('Run');
  } else if (activityType === 'Swim' || activityType === 'OpenWaterSwim') {
    matchingTypes.push('Swim');
  } else if (activityType === 'Hike' || activityType === 'Walk') {
    matchingTypes.push('Hike', 'Run'); // Hike can use Run routes too
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

  return routes[Math.floor(Math.random() * routes.length)];
}
