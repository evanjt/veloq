/**
 * Map stress test data generator.
 *
 * Generates 800 synthetic activities with extended GPS traces (100km+ rides)
 * for map durability testing. Activated via the debug dashboard, not part of
 * normal demo mode. Uses existing routes from realRoutes.json concatenated
 * and repeated with GPS jitter to simulate heavy real-world usage.
 */

import { demoRoutes, getRouteCoordinates } from './routes';
import { createSeededRandom } from './random';

interface StressMapResult {
  ids: string[];
  coords: number[];
  offsets: number[];
  sportTypes: string[];
  totalPoints: number;
}

interface RegionConfig {
  sportType: string;
  routeIds: string[];
  count: number;
  repeats: number; // how many times to chain/repeat routes for length
}

const REGIONS: RegionConfig[] = [
  {
    sportType: 'Ride',
    routeIds: ['route-valais-ride-1', 'route-valais-ride-2'],
    count: 200,
    repeats: 3,
  },
  {
    sportType: 'VirtualRide',
    routeIds: ['route-rouvy-grindelwald', 'route-rouvy-lavaux', 'route-rouvy-vuelta'],
    count: 100,
    repeats: 2,
  },
  {
    sportType: 'Ride',
    routeIds: ['route-rouvy-rio'],
    count: 100,
    repeats: 4,
  },
  {
    sportType: 'Run',
    routeIds: ['route-rio-run-1', 'route-rio-run-2', 'route-rio-run-3', 'route-rio-run-4'],
    count: 150,
    repeats: 1,
  },
  {
    sportType: 'Run',
    routeIds: ['route-cape-town-walk-3', 'route-cape-town-walk-5', 'route-cape-town-walk-6'],
    count: 100,
    repeats: 2,
  },
  {
    sportType: 'Swim',
    routeIds: ['route-la-orotava-swim-1', 'route-la-orotava-swim-2', 'route-la-orotava-swim-3'],
    count: 80,
    repeats: 1,
  },
  {
    sportType: 'Hike',
    routeIds: [
      'route-lauterbrunnen-hike-1',
      'route-lauterbrunnen-hike-2',
      'route-lauterbrunnen-hike-3',
    ],
    count: 70,
    repeats: 1,
  },
];

const METERS_TO_DEG = 1 / 111320;

function addJitter(
  coords: [number, number][],
  rng: () => number,
  jitterMeters: number
): [number, number][] {
  const result: [number, number][] = [];
  for (const [lat, lng] of coords) {
    if (rng() < 0.015) continue; // 1.5% dropout
    const dLat = (rng() - 0.5) * 2 * jitterMeters * METERS_TO_DEG;
    const dLng =
      ((rng() - 0.5) * 2 * jitterMeters * METERS_TO_DEG) / Math.cos((lat * Math.PI) / 180);
    result.push([lat + dLat, lng + dLng]);
  }
  return result;
}

function chainRoutes(routeIds: string[], repeats: number, rng: () => number): [number, number][] {
  const segments: [number, number][][] = [];

  for (let r = 0; r < repeats; r++) {
    for (const id of routeIds) {
      const base = getRouteCoordinates(id);
      if (base.length < 4) continue;
      const jitter = 5 + rng() * 10;
      const startTrim = Math.floor(rng() * Math.min(4, base.length * 0.05));
      const endTrim = Math.floor(rng() * Math.min(4, base.length * 0.05));
      const trimmed = base.slice(startTrim, base.length - endTrim || undefined);
      const direction = rng() > 0.3 ? 1 : -1;
      const ordered = direction === 1 ? trimmed : [...trimmed].reverse();
      segments.push(addJitter(ordered, rng, jitter));
    }
  }

  const result: [number, number][] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i > 0 && result.length > 0 && seg.length > 0) {
      const last = result[result.length - 1];
      const first = seg[0];
      const midLat = (last[0] + first[0]) / 2;
      const midLng = (last[1] + first[1]) / 2;
      result.push([midLat, midLng]);
    }
    result.push(...seg);
  }

  return result;
}

export function generateStressMapActivities(): StressMapResult {
  const ids: string[] = [];
  const coords: number[] = [];
  const offsets: number[] = [];
  const sportTypes: string[] = [];
  let activityIndex = 0;

  const masterRng = createSeededRandom('stress-map-v1');

  for (const region of REGIONS) {
    for (let i = 0; i < region.count; i++) {
      const actId = `stress-map-${activityIndex}`;
      const rng = createSeededRandom(`${actId}-gps`);

      const routeSubset =
        region.routeIds.length > 1 ? region.routeIds.filter(() => rng() > 0.3) : region.routeIds;
      const selectedRoutes = routeSubset.length > 0 ? routeSubset : [region.routeIds[0]];

      const repeatCount = Math.max(1, region.repeats + Math.floor((masterRng() - 0.5) * 2));
      const track = chainRoutes(selectedRoutes, repeatCount, rng);

      if (track.length < 4) {
        activityIndex++;
        continue;
      }

      ids.push(actId);
      offsets.push(coords.length / 2);
      sportTypes.push(region.sportType);

      for (const [lat, lng] of track) {
        coords.push(lat, lng);
      }

      activityIndex++;
    }
  }

  return {
    ids,
    coords,
    offsets,
    sportTypes,
    totalPoints: coords.length / 2,
  };
}

export function getStressDataSummary(): {
  totalActivities: number;
  estimatedPoints: number;
  regions: string[];
} {
  const totalActivities = REGIONS.reduce((sum, r) => sum + r.count, 0);
  let estimatedPoints = 0;
  for (const region of REGIONS) {
    let avgRoutePoints = 0;
    for (const id of region.routeIds) {
      const route = demoRoutes.find((r) => r.id === id);
      avgRoutePoints += route?.coordinates.length ?? 200;
    }
    avgRoutePoints = avgRoutePoints / region.routeIds.length;
    estimatedPoints += region.count * avgRoutePoints * region.repeats * region.routeIds.length;
  }

  const regions = [
    ...new Set(
      REGIONS.flatMap((r) =>
        r.routeIds.map((id) => demoRoutes.find((route) => route.id === id)?.region ?? 'Unknown')
      )
    ),
  ];

  return { totalActivities, estimatedPoints: Math.round(estimatedPoints), regions };
}
