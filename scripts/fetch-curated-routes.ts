/**
 * Fetch Curated Demo Routes from OpenStreetMap
 *
 * This script fetches specific well-ordered OSM ways/relations and properly
 * reconstructs them into continuous paths for demo mode.
 *
 * Data Source: OpenStreetMap (ODbL License)
 * Attribution: "© OpenStreetMap contributors"
 * License: https://www.openstreetmap.org/copyright
 *
 * Usage:
 *   npx tsx scripts/fetch-curated-routes.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Types
interface Coordinate {
  lat: number;
  lng: number;
}

interface DemoRoute {
  id: string;
  name: string;
  type: 'Ride' | 'Run' | 'Swim' | 'Hike' | 'VirtualRide';
  coordinates: [number, number][];
  distance: number;
  elevation: number;
  region: string;
  attribution: string;
}

interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: 'way';
  id: number;
  nodes: number[];
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

interface OverpassRelation {
  type: 'relation';
  id: number;
  members: Array<{
    type: string;
    ref: number;
    role: string;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
  tags?: Record<string, string>;
}

type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

interface OverpassResponse {
  elements: OverpassElement[];
}

// Constants
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const OUTPUT_FILE = path.join(SCRIPT_DIR, '..', 'src', 'data', 'demo', 'realRoutes.json');
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
const ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';
const MAX_GAP_METERS = 500; // Maximum allowed gap between consecutive points

// Curated route definitions - specific ways/relations known to be well-ordered
const CURATED_ROUTES: Array<{
  name: string;
  query: string;
  type: DemoRoute['type'];
  region: string;
  targetPoints: number;
  isRelation?: boolean;
}> = [
  // Cycling Routes - specific continuous ways
  {
    name: 'Embarcadero Waterfront',
    query: `way(28397540);`, // SF Embarcadero
    type: 'Ride',
    region: 'San Francisco, USA',
    targetPoints: 150,
  },
  {
    name: 'Richmond Park Perimeter',
    query: `way["name"="Tamsin Trail"](51.43,-0.30,51.46,-0.25);`,
    type: 'Ride',
    region: 'London, UK',
    targetPoints: 200,
  },
  {
    name: 'Sydney Harbour Foreshore',
    query: `way["name"="Mrs Macquaries Road"](-33.87,151.21,-33.85,151.23);`,
    type: 'Ride',
    region: 'Sydney, Australia',
    targetPoints: 100,
  },
  // Running Routes
  {
    name: 'Central Park Loop',
    query: `way["name"="Park Drive"]["highway"](40.76,-73.98,40.80,-73.95);`,
    type: 'Run',
    region: 'New York, USA',
    targetPoints: 200,
  },
  {
    name: 'Bondi to Bronte Coastal Walk',
    query: `way["name"~"Bondi|Coastal Walk"]["highway"="footway"](-33.91,151.26,-33.89,151.28);`,
    type: 'Run',
    region: 'Sydney, Australia',
    targetPoints: 150,
  },
  {
    name: 'Hyde Park Serpentine Path',
    query: `way["name"~"Serpentine"]["highway"](51.505,-0.17,51.515,-0.15);`,
    type: 'Run',
    region: 'London, UK',
    targetPoints: 100,
  },
];

// Haversine distance calculation
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate total route distance
function calculateDistance(coords: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineDistance(coords[i - 1].lat, coords[i - 1].lng, coords[i].lat, coords[i].lng);
  }
  return Math.round(total);
}

// Ramer-Douglas-Peucker simplification
function perpendicularDistance(
  point: Coordinate,
  lineStart: Coordinate,
  lineEnd: Coordinate
): number {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;

  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      Math.pow(point.lng - lineStart.lng, 2) + Math.pow(point.lat - lineStart.lat, 2)
    );
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / (dx * dx + dy * dy)
    )
  );

  const projX = lineStart.lng + t * dx;
  const projY = lineStart.lat + t * dy;

  return Math.sqrt(Math.pow(point.lng - projX, 2) + Math.pow(point.lat - projY, 2));
}

function rdpSimplify(points: Coordinate[], epsilon: number): Coordinate[] {
  if (points.length < 3) return points;

  let maxDist = 0;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, maxIndex + 1), epsilon);
    const right = rdpSimplify(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0], points[points.length - 1]];
}

function simplifyToTargetPoints(points: Coordinate[], targetPoints: number): Coordinate[] {
  if (points.length <= targetPoints) return points;

  let low = 0;
  let high = 0.01;
  let result = points;

  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    result = rdpSimplify(points, mid);

    if (result.length > targetPoints) {
      low = mid;
    } else if (result.length < targetPoints * 0.8) {
      high = mid;
    } else {
      break;
    }
  }

  return result;
}

// Validate route continuity - check for large gaps
function validateContinuity(coords: Coordinate[]): { valid: boolean; maxGap: number } {
  let maxGap = 0;
  for (let i = 1; i < coords.length; i++) {
    const gap = haversineDistance(coords[i - 1].lat, coords[i - 1].lng, coords[i].lat, coords[i].lng);
    maxGap = Math.max(maxGap, gap);
  }
  return { valid: maxGap <= MAX_GAP_METERS, maxGap };
}

// Order ways to form a continuous path
function orderWaysIntoContinuousPath(ways: Array<{ geometry: Coordinate[] }>): Coordinate[] {
  if (ways.length === 0) return [];
  if (ways.length === 1) return ways[0].geometry;

  const result: Coordinate[] = [...ways[0].geometry];
  const remaining = ways.slice(1);

  while (remaining.length > 0) {
    const lastPoint = result[result.length - 1];
    let bestIdx = -1;
    let bestDist = Infinity;
    let reverse = false;

    // Find the way that connects best to the end of our current path
    for (let i = 0; i < remaining.length; i++) {
      const way = remaining[i].geometry;
      if (way.length === 0) continue;

      const startDist = haversineDistance(lastPoint.lat, lastPoint.lng, way[0].lat, way[0].lng);
      const endDist = haversineDistance(
        lastPoint.lat,
        lastPoint.lng,
        way[way.length - 1].lat,
        way[way.length - 1].lng
      );

      if (startDist < bestDist) {
        bestDist = startDist;
        bestIdx = i;
        reverse = false;
      }
      if (endDist < bestDist) {
        bestDist = endDist;
        bestIdx = i;
        reverse = true;
      }
    }

    if (bestIdx === -1) break;

    const nextWay = remaining.splice(bestIdx, 1)[0];
    const coords = reverse ? [...nextWay.geometry].reverse() : nextWay.geometry;

    // Skip first point if it's very close to last point (avoid duplicates)
    const skipFirst =
      coords.length > 0 &&
      haversineDistance(lastPoint.lat, lastPoint.lng, coords[0].lat, coords[0].lng) < 10;

    result.push(...(skipFirst ? coords.slice(1) : coords));
  }

  return result;
}

// Extract and order coordinates from Overpass response
function extractOrderedCoordinates(elements: OverpassElement[]): Coordinate[] {
  const ways: Array<{ id: number; geometry: Coordinate[] }> = [];

  for (const element of elements) {
    if (element.type === 'way' && element.geometry) {
      ways.push({
        id: element.id,
        geometry: element.geometry.map((p) => ({ lat: p.lat, lng: p.lon })),
      });
    } else if (element.type === 'relation') {
      // For relations, extract member geometries in order
      for (const member of element.members) {
        if (member.geometry) {
          ways.push({
            id: member.ref,
            geometry: member.geometry.map((p) => ({ lat: p.lat, lng: p.lon })),
          });
        }
      }
    }
  }

  // If we have multiple ways, order them into a continuous path
  if (ways.length > 1) {
    return orderWaysIntoContinuousPath(ways);
  } else if (ways.length === 1) {
    return ways[0].geometry;
  }

  return [];
}

// Remove consecutive duplicate points
function deduplicateCoords(coords: Coordinate[]): Coordinate[] {
  return coords.filter(
    (coord, i) => i === 0 || coord.lat !== coords[i - 1].lat || coord.lng !== coords[i - 1].lng
  );
}

// Fetch from Overpass API
async function fetchOverpass(query: string): Promise<OverpassResponse> {
  const fullQuery = `[out:json][timeout:60];${query}out geom;`;

  console.log(`  Querying Overpass API...`);

  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(fullQuery)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  return response.json();
}

// Generate a synthetic swim course (simple arc/loop)
function generateSwimCourse(center: Coordinate, lengthMeters: number): Coordinate[] {
  const coords: Coordinate[] = [];
  const points = 50;
  // Approximate radius for the desired length (half-circle)
  const radiusMeters = lengthMeters / Math.PI;
  const radiusDeg = radiusMeters / 111000; // Rough conversion

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI; // Half circle
    coords.push({
      lat: center.lat + Math.sin(angle) * radiusDeg * 0.5,
      lng: center.lng + Math.cos(angle) * radiusDeg,
    });
  }

  return coords;
}

// Generate a realistic route following a curved path (simulates roads/trails)
function generateRealisticRoute(
  center: Coordinate,
  lengthMeters: number,
  style: 'loop' | 'outback' | 'figure8'
): Coordinate[] {
  const coords: Coordinate[] = [];
  const points = Math.max(100, Math.floor(lengthMeters / 50)); // Point every ~50m
  const metersPerDegLat = 111000;
  const metersPerDegLng = 111000 * Math.cos((center.lat * Math.PI) / 180);

  // Add some randomness to make it look natural
  const jitter = () => (Math.random() - 0.5) * 0.0001;

  if (style === 'loop') {
    // Irregular loop shape
    const circumference = lengthMeters;
    const avgRadius = circumference / (2 * Math.PI);

    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * 2 * Math.PI;
      // Vary radius to create irregular shape
      const radiusVar = avgRadius * (0.8 + 0.4 * Math.sin(angle * 3) + 0.2 * Math.cos(angle * 5));
      const latOffset = (Math.sin(angle) * radiusVar) / metersPerDegLat;
      const lngOffset = (Math.cos(angle) * radiusVar) / metersPerDegLng;
      coords.push({
        lat: center.lat + latOffset + jitter(),
        lng: center.lng + lngOffset + jitter(),
      });
    }
  } else if (style === 'outback') {
    // Out and back with slight variation
    const halfLength = lengthMeters / 2;
    const pointsPerLeg = Math.floor(points / 2);

    // Outbound leg - winding path
    for (let i = 0; i <= pointsPerLeg; i++) {
      const progress = i / pointsPerLeg;
      const mainOffset = (progress * halfLength) / metersPerDegLat;
      const sideOffset = (Math.sin(progress * Math.PI * 4) * 200) / metersPerDegLng;
      coords.push({
        lat: center.lat + mainOffset + jitter(),
        lng: center.lng + sideOffset + jitter(),
      });
    }

    // Return leg - slightly different path
    for (let i = pointsPerLeg; i >= 0; i--) {
      const progress = i / pointsPerLeg;
      const mainOffset = (progress * halfLength) / metersPerDegLat;
      const sideOffset = (Math.sin(progress * Math.PI * 4 + 0.5) * 180) / metersPerDegLng;
      coords.push({
        lat: center.lat + mainOffset + jitter() * 2,
        lng: center.lng + sideOffset + 0.0003 + jitter() * 2,
      });
    }
  } else if (style === 'figure8') {
    // Figure-8 pattern
    const loopRadius = lengthMeters / (4 * Math.PI);

    for (let i = 0; i <= points; i++) {
      const t = (i / points) * 4 * Math.PI;
      // Lemniscate of Bernoulli (figure-8)
      const scale = loopRadius / metersPerDegLat;
      const denom = 1 + Math.sin(t) * Math.sin(t);
      coords.push({
        lat: center.lat + (scale * Math.cos(t)) / denom + jitter(),
        lng: center.lng + ((scale * Math.sin(t) * Math.cos(t)) / denom) * 1.5 + jitter(),
      });
    }
  }

  return coords;
}

// Synthetic route definitions for fallback
interface SyntheticRouteDef {
  name: string;
  type: DemoRoute['type'];
  region: string;
  center: Coordinate;
  lengthMeters: number;
  style: 'loop' | 'outback' | 'figure8';
}

const SYNTHETIC_ROUTES: SyntheticRouteDef[] = [
  // Cycling routes
  {
    name: 'Bay Loop Ride',
    type: 'Ride',
    region: 'San Francisco, USA',
    center: { lat: 37.8044, lng: -122.2712 },
    lengthMeters: 35000,
    style: 'loop',
  },
  {
    name: 'Richmond Park Circuit',
    type: 'Ride',
    region: 'London, UK',
    center: { lat: 51.4425, lng: -0.2757 },
    lengthMeters: 12000,
    style: 'loop',
  },
  {
    name: 'Centennial Park Loop',
    type: 'Ride',
    region: 'Sydney, Australia',
    center: { lat: -33.8986, lng: 151.2352 },
    lengthMeters: 8000,
    style: 'loop',
  },
  {
    name: 'Vondelpark Circuit',
    type: 'Ride',
    region: 'Amsterdam, Netherlands',
    center: { lat: 52.3579, lng: 4.8686 },
    lengthMeters: 5000,
    style: 'figure8',
  },
  // Running routes
  {
    name: 'Central Park Run',
    type: 'Run',
    region: 'New York, USA',
    center: { lat: 40.7829, lng: -73.9654 },
    lengthMeters: 10000,
    style: 'loop',
  },
  {
    name: 'Bondi to Bronte',
    type: 'Run',
    region: 'Sydney, Australia',
    center: { lat: -33.8956, lng: 151.2743 },
    lengthMeters: 4000,
    style: 'outback',
  },
  {
    name: 'Hyde Park Run',
    type: 'Run',
    region: 'London, UK',
    center: { lat: 51.5073, lng: -0.1657 },
    lengthMeters: 5000,
    style: 'loop',
  },
];

// Main function
async function main() {
  console.log('Generating demo routes...\n');

  const routes: DemoRoute[] = [];
  let idCounter = 1;

  // Generate all synthetic routes (more reliable than OSM API)
  console.log('=== Generating Synthetic Routes ===\n');

  for (const routeDef of SYNTHETIC_ROUTES) {
    console.log(`Generating: ${routeDef.name}`);

    const coords = generateRealisticRoute(routeDef.center, routeDef.lengthMeters, routeDef.style);
    const distance = calculateDistance(coords);

    // Simplify if too many points
    const simplified = simplifyToTargetPoints(coords, 200);

    routes.push({
      id: `route-${idCounter++}`,
      name: routeDef.name,
      type: routeDef.type,
      coordinates: simplified.map((c) => [c.lat, c.lng]),
      distance,
      elevation: 0,
      region: routeDef.region,
      attribution: 'Generated demo route',
    });

    console.log(`  Added: ${simplified.length} points, ${(distance / 1000).toFixed(1)} km`);
  }

  // Add synthetic swim course
  console.log('\nGenerating: Bondi Beach Swim Course');
  const swimCoords = generateSwimCourse({ lat: -33.8915, lng: 151.2767 }, 1000);
  routes.push({
    id: `route-${idCounter++}`,
    name: 'Bondi Beach Swim Course',
    type: 'Swim',
    coordinates: swimCoords.map((c) => [c.lat, c.lng]),
    distance: calculateDistance(swimCoords),
    elevation: 0,
    region: 'Sydney, Australia',
    attribution: 'Generated demo route',
  });
  console.log(`  Added: ${swimCoords.length} points, ${(calculateDistance(swimCoords) / 1000).toFixed(1)} km`);

  // Optionally try to fetch real OSM routes as well
  console.log('\n=== Attempting OSM Fetch (optional) ===\n');

  for (const routeDef of CURATED_ROUTES) {
    console.log(`Fetching: ${routeDef.name}`);

    try {
      const response = await fetchOverpass(routeDef.query);

      if (response.elements.length === 0) {
        console.log(`  No data found, skipping.`);
        continue;
      }

      let coords = extractOrderedCoordinates(response.elements);
      coords = deduplicateCoords(coords);

      if (coords.length < 10) {
        console.log(`  Too few points (${coords.length}), skipping.`);
        continue;
      }

      // Validate continuity
      const { valid, maxGap } = validateContinuity(coords);
      if (!valid) {
        console.log(`  Route has gap of ${Math.round(maxGap)}m (max ${MAX_GAP_METERS}m), skipping.`);
        continue;
      }

      console.log(`  Found ${coords.length} points, max gap: ${Math.round(maxGap)}m`);

      // Simplify to target points
      const simplified = simplifyToTargetPoints(coords, routeDef.targetPoints);
      const distance = calculateDistance(simplified);

      // Skip if too short
      if (distance < 500) {
        console.log(`  Too short (${distance}m), skipping.`);
        continue;
      }

      routes.push({
        id: `route-osm-${idCounter++}`,
        name: routeDef.name,
        type: routeDef.type,
        coordinates: simplified.map((c) => [c.lat, c.lng]),
        distance,
        elevation: 0,
        region: routeDef.region,
        attribution: ATTRIBUTION,
      });

      console.log(`  Added: ${simplified.length} points, ${(distance / 1000).toFixed(1)} km`);

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) {
      console.log(`  Error: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total routes: ${routes.length}`);
  console.log(`  Cycling: ${routes.filter((r) => r.type === 'Ride').length}`);
  console.log(`  Running: ${routes.filter((r) => r.type === 'Run').length}`);
  console.log(`  Swimming: ${routes.filter((r) => r.type === 'Swim').length}`);

  // Calculate file size
  const jsonStr = JSON.stringify(routes, null, 2);
  const sizeKB = Buffer.byteLength(jsonStr, 'utf-8') / 1024;
  console.log(`\nOutput size: ${sizeKB.toFixed(1)} KB`);

  // Write output
  fs.writeFileSync(OUTPUT_FILE, jsonStr);
  console.log(`\nWritten to: ${OUTPUT_FILE}`);

  // Print routes for reference
  console.log('\n=== Routes ===');
  for (const route of routes) {
    console.log(`  ${route.id}: ${route.name} (${route.type}) - ${route.region}`);
    console.log(`    ${route.coordinates.length} points, ${(route.distance / 1000).toFixed(1)} km`);
  }
}

main().catch(console.error);
