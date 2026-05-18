/**
 * Map stress test data generator.
 *
 * Generates 2000 synthetic activities with extended GPS traces (some 100km+)
 * for map durability testing. Activated via the debug dashboard, not part of
 * normal demo mode. Returns full metadata so the feed and map render properly.
 */

import { demoRoutes, getRouteCoordinates } from './routes';
import { createSeededRandom } from './random';

export interface StressMapResult {
  ids: string[];
  coords: number[];
  offsets: number[];
  sportTypes: string[];
  metrics: StressActivityMetric[];
  totalPoints: number;
  longestKm: number;
}

export interface StressActivityMetric {
  activityId: string;
  name: string;
  date: bigint;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  elevationGain: number;
  avgHr?: number;
  avgPower?: number;
  sportType: string;
  trainingLoad?: number;
  ftp?: number;
}

interface RegionConfig {
  sportType: string;
  routeIds: string[];
  count: number;
  /** How many times to chain routes per activity (1=normal, 5+=ultra long) */
  minRepeats: number;
  maxRepeats: number;
  /** Avg speed in m/s for time/HR estimation */
  speedMs: number;
  avgHr: number;
  avgPower?: number;
}

const REGIONS: RegionConfig[] = [
  // Long cycling in Swiss Alps — 50-200km rides via route chaining
  {
    sportType: 'Ride',
    routeIds: ['route-valais-ride-1', 'route-valais-ride-2'],
    count: 400,
    minRepeats: 1,
    maxRepeats: 4,
    speedMs: 7.5,
    avgHr: 145,
    avgPower: 200,
  },
  // Virtual rides in multiple regions — 20-80km
  {
    sportType: 'VirtualRide',
    routeIds: ['route-rouvy-grindelwald', 'route-rouvy-lavaux', 'route-rouvy-vuelta'],
    count: 300,
    minRepeats: 1,
    maxRepeats: 3,
    speedMs: 8.0,
    avgHr: 150,
    avgPower: 210,
  },
  // Brazil rides — 10-40km
  {
    sportType: 'Ride',
    routeIds: ['route-rouvy-rio'],
    count: 200,
    minRepeats: 1,
    maxRepeats: 4,
    speedMs: 7.0,
    avgHr: 148,
    avgPower: 195,
  },
  // Rio runs
  {
    sportType: 'Run',
    routeIds: ['route-rio-run-1', 'route-rio-run-2', 'route-rio-run-3', 'route-rio-run-4'],
    count: 350,
    minRepeats: 1,
    maxRepeats: 2,
    speedMs: 3.2,
    avgHr: 155,
  },
  // Cape Town walks/runs
  {
    sportType: 'Run',
    routeIds: ['route-cape-town-walk-3', 'route-cape-town-walk-5', 'route-cape-town-walk-6'],
    count: 250,
    minRepeats: 1,
    maxRepeats: 3,
    speedMs: 2.8,
    avgHr: 145,
  },
  // Tenerife swims
  {
    sportType: 'Swim',
    routeIds: ['route-la-orotava-swim-1', 'route-la-orotava-swim-2', 'route-la-orotava-swim-3'],
    count: 150,
    minRepeats: 1,
    maxRepeats: 2,
    speedMs: 1.2,
    avgHr: 130,
  },
  // Lauterbrunnen hikes — long routes 10-30km
  {
    sportType: 'Hike',
    routeIds: [
      'route-lauterbrunnen-hike-1',
      'route-lauterbrunnen-hike-2',
      'route-lauterbrunnen-hike-3',
    ],
    count: 200,
    minRepeats: 1,
    maxRepeats: 3,
    speedMs: 1.5,
    avgHr: 130,
  },
  // Cape Town walks
  {
    sportType: 'Walk',
    routeIds: [
      'route-cape-town-walk-1',
      'route-cape-town-walk-2',
      'route-cape-town-walk-3',
      'route-cape-town-walk-7',
      'route-cape-town-walk-8',
    ],
    count: 150,
    minRepeats: 1,
    maxRepeats: 2,
    speedMs: 1.4,
    avgHr: 115,
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
    if (rng() < 0.012) continue;
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
      const jitter = 4 + rng() * 8;
      const direction = rng() > 0.35 ? 1 : -1;
      const ordered = direction === 1 ? base : [...base].reverse();
      segments.push(addJitter(ordered, rng, jitter));
    }
  }
  const result: [number, number][] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i > 0 && result.length > 0 && seg.length > 0) {
      result.push([
        (result[result.length - 1][0] + seg[0][0]) / 2,
        (result[result.length - 1][1] + seg[0][1]) / 2,
      ]);
    }
    result.push(...seg);
  }
  return result;
}

function approxDistance(coords: [number, number][]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lat1, lng1] = coords[i - 1];
    const [lat2, lng2] = coords[i];
    const dLat = (lat2 - lat1) * 111320;
    const dLng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
    d += Math.sqrt(dLat * dLat + dLng * dLng);
  }
  return d;
}

function buildActivity(
  region: RegionConfig,
  activityIndex: number,
  nowSec: bigint,
  dayInSec: bigint
): { id: string; track: [number, number][]; metric: StressActivityMetric; distKm: number } | null {
  const actId = `stress-map-${activityIndex}`;
  const rng = createSeededRandom(`${actId}-gps`);
  const repeats =
    region.minRepeats + Math.floor(rng() * (region.maxRepeats - region.minRepeats + 1));
  const track = chainRoutes(region.routeIds, repeats, rng);
  if (track.length < 4) return null;

  const distMeters = approxDistance(track);
  const distKm = distMeters / 1000;
  const movingTime = Math.floor(distMeters / region.speedMs);
  const elevationGain = Math.floor(
    distKm * (region.sportType === 'Hike' ? 80 : region.sportType.includes('Ride') ? 15 : 25)
  );
  const daysAgo = BigInt(Math.floor(rng() * 730));
  const date = nowSec - daysAgo * dayInSec;
  const hrJitter = Math.floor((rng() - 0.5) * 20);
  const trainingLoad = Math.floor(
    (movingTime / 3600) * (region.sportType.includes('Ride') ? 80 : 60)
  );

  const metric: StressActivityMetric = {
    activityId: actId,
    name: `Stress ${region.sportType} ${activityIndex}`,
    date,
    distance: distMeters,
    movingTime,
    elapsedTime: movingTime + Math.floor(rng() * 300),
    elevationGain,
    avgHr: region.avgHr + hrJitter,
    avgPower: region.avgPower ? region.avgPower + Math.floor((rng() - 0.5) * 30) : undefined,
    sportType: region.sportType,
    trainingLoad,
    ftp: region.avgPower ? 250 : undefined,
  };

  return { id: actId, track, metric, distKm };
}

export function generateStressMapActivities(maxCount?: number): StressMapResult {
  const all: StressMapResult = {
    ids: [],
    coords: [],
    offsets: [],
    sportTypes: [],
    metrics: [],
    totalPoints: 0,
    longestKm: 0,
  };
  for (const chunk of generateStressMapChunks(maxCount, Infinity)) {
    for (const id of chunk.ids) all.ids.push(id);
    const baseOffset = all.coords.length / 2;
    for (const off of chunk.offsets) all.offsets.push(baseOffset + off);
    for (const c of chunk.coords) all.coords.push(c);
    for (const st of chunk.sportTypes) all.sportTypes.push(st);
    for (const m of chunk.metrics) all.metrics.push(m);
    if (chunk.longestKm > all.longestKm) all.longestKm = chunk.longestKm;
  }
  all.totalPoints = all.coords.length / 2;
  return all;
}

/**
 * Streams stress activities in chunks so callers can yield to the event loop
 * and push each chunk to FFI without blocking the JS thread for tens of seconds.
 * Each yielded chunk has fresh `offsets` starting at 0 (relative to its own
 * coords array) so it can be passed straight to `activities().add(...)`.
 */
export function* generateStressMapChunks(
  maxCount?: number,
  chunkSize: number = 100
): Generator<StressMapResult, void, unknown> {
  const limit = maxCount ?? Infinity;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const dayInSec = 86400n;

  let chunkIds: string[] = [];
  let chunkCoords: number[] = [];
  let chunkOffsets: number[] = [];
  let chunkSports: string[] = [];
  let chunkMetrics: StressActivityMetric[] = [];
  let chunkLongest = 0;
  let activityIndex = 0;
  let producedTotal = 0;

  const flush = (): StressMapResult | null => {
    if (chunkIds.length === 0) return null;
    const out: StressMapResult = {
      ids: chunkIds,
      coords: chunkCoords,
      offsets: chunkOffsets,
      sportTypes: chunkSports,
      metrics: chunkMetrics,
      totalPoints: chunkCoords.length / 2,
      longestKm: chunkLongest,
    };
    chunkIds = [];
    chunkCoords = [];
    chunkOffsets = [];
    chunkSports = [];
    chunkMetrics = [];
    chunkLongest = 0;
    return out;
  };

  for (const region of REGIONS) {
    if (producedTotal >= limit) break;
    for (let i = 0; i < region.count && producedTotal < limit; i++) {
      const built = buildActivity(region, activityIndex, nowSec, dayInSec);
      activityIndex++;
      if (!built) continue;

      chunkIds.push(built.id);
      chunkOffsets.push(chunkCoords.length / 2);
      chunkSports.push(region.sportType);
      for (const [lat, lng] of built.track) {
        chunkCoords.push(lat, lng);
      }
      chunkMetrics.push(built.metric);
      if (built.distKm > chunkLongest) chunkLongest = built.distKm;
      producedTotal++;

      if (chunkIds.length >= chunkSize) {
        const out = flush();
        if (out) yield out;
      }
    }
  }

  const tail = flush();
  if (tail) yield tail;
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
    const avgRepeats = (region.minRepeats + region.maxRepeats) / 2;
    estimatedPoints += region.count * avgRoutePoints * avgRepeats * region.routeIds.length;
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
