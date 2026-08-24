/**
 * Demo GPS route templates
 *
 * Real GPS routes from OpenStreetMap (ODbL License)
 * Attribution: "© OpenStreetMap contributors"
 * License: https://www.openstreetmap.org/copyright
 */

import realRoutesData from './realRoutes.json';
import { getBoundsFromPoints } from '@/shared/geo/polyline';

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

const baseRoutes: DemoRoute[] = realRoutesData as DemoRoute[];

/**
 * Synthetic out-and-back derived from an existing one-way route.
 * Section detection will see the same stretch traversed forward and then
 * reverse inside a single activity, producing the two (section, direction)
 * pairs that US-S1 exercises.
 */
function buildOutAndBack(sourceId: string, id: string, name: string): DemoRoute | null {
  const source = baseRoutes.find((r) => r.id === sourceId);
  if (!source) return null;
  const fwd = source.coordinates;
  const rev = [...fwd].slice(0, fwd.length - 1).reverse();
  return {
    id,
    name,
    type: source.type,
    coordinates: [...fwd, ...rev],
    distance: source.distance * 2,
    elevation: source.elevation * 2,
    region: source.region,
    attribution: source.attribution,
  };
}

const outAndBack = buildOutAndBack(
  'route-rio-run-1',
  'route-rio-run-1-outback',
  'Rio Run (out & back)'
);

/**
 * Real routes from OpenStreetMap, plus synthetic demo derivations.
 * These are actual GPS routes from cycling paths, running trails, etc.
 */
export const demoRoutes: DemoRoute[] = outAndBack ? [...baseRoutes, outAndBack] : baseRoutes;

/**
 * Get a route's coordinates (exact, no variation)
 */
export function getRouteCoordinates(routeId: string): [number, number][] {
  const route = demoRoutes.find((r) => r.id === routeId);
  if (!route) return [];
  return route.coordinates;
}

/**
 * Get route coordinates with per-activity GPS variation.
 * Adds realistic jitter, shifted start/end, and occasional dropouts
 * so each traversal looks slightly different while still matching
 * the same section in detection.
 */
export function getRouteCoordinatesWithVariation(
  routeId: string,
  rng: () => number
): [number, number][] {
  const base = getRouteCoordinates(routeId);
  if (base.length < 4) return base;

  const metersToDeg = 1 / 111320;
  const jitterMeters = 3 + rng() * 5;

  const startTrim = Math.floor(rng() * Math.min(6, Math.floor(base.length * 0.08)));
  const endTrim = Math.floor(rng() * Math.min(6, Math.floor(base.length * 0.08)));
  const trimmed = base.slice(startTrim, base.length - endTrim || undefined);

  const result: [number, number][] = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (rng() < 0.02 && i > 0 && i < trimmed.length - 1) continue;

    const [lat, lng] = trimmed[i];
    const dLat = (rng() - 0.5) * 2 * jitterMeters * metersToDeg;
    const dLng = ((rng() - 0.5) * 2 * jitterMeters * metersToDeg) / Math.cos((lat * Math.PI) / 180);
    result.push([lat + dLat, lng + dLng]);
  }

  return result;
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
