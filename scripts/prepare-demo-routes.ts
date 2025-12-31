/**
 * Prepare Demo Routes from OpenStreetMap
 *
 * This script fetches real route data from OpenStreetMap via Overpass API
 * and outputs a curated JSON file for use in demo mode.
 *
 * Data Source: OpenStreetMap (ODbL License)
 * Attribution: "© OpenStreetMap contributors"
 * License: https://www.openstreetmap.org/copyright
 *
 * Usage:
 *   npx tsx scripts/prepare-demo-routes.ts
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

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{
    type: string;
    ref: number;
    role: string;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

// Constants
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const OUTPUT_FILE = path.join(
  SCRIPT_DIR,
  '..',
  'src',
  'data',
  'demo',
  'realRoutes.json'
);
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
const TARGET_POINTS = 300;
const ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';

// Route definitions to fetch
const ROUTES_TO_FETCH = [
  // European cycling routes (EuroVelo)
  {
    name: 'EuroVelo 15 - Rhine Cycle Route',
    query: `relation["ref"="EV15"]["route"="bicycle"](47.0,6.0,52.0,9.0);`,
    type: 'Ride' as const,
    region: 'Europe (Rhine Valley)',
    maxPoints: 500,
  },
  {
    name: 'EuroVelo 6 - Atlantic to Black Sea',
    query: `relation["ref"="EV6"]["route"="bicycle"](47.0,2.0,48.5,5.0);`,
    type: 'Ride' as const,
    region: 'France (Loire Valley)',
    maxPoints: 400,
  },
  // UK cycling
  {
    name: 'National Cycle Route 1',
    query: `relation["ref"="1"]["network"="ncn"]["route"="bicycle"](51.0,-0.5,52.0,0.5);`,
    type: 'Ride' as const,
    region: 'United Kingdom',
    maxPoints: 400,
  },
  // US cycling
  {
    name: 'San Francisco Bay Trail',
    query: `way["name"~"Bay Trail"]["highway"](37.7,-122.5,37.9,-122.2);`,
    type: 'Ride' as const,
    region: 'San Francisco, USA',
    maxPoints: 300,
  },
  // Australian cycling - use a park trail
  {
    name: 'Sydney Harbour Bridge Path',
    query: `way["name"~"Harbour Bridge"]["highway"="cycleway"](-33.9,151.1,-33.8,151.3);`,
    type: 'Ride' as const,
    region: 'Sydney, Australia',
    maxPoints: 200,
  },
  // Running/hiking trails
  {
    name: 'Thames Path',
    query: `relation["name"="Thames Path"]["route"="hiking"](51.4,-0.3,51.6,0.1);`,
    type: 'Run' as const,
    region: 'London, UK',
    maxPoints: 400,
  },
  {
    name: 'Coastal Walk - Bondi to Coogee',
    query: `way["name"~"Bondi.*Coogee|Coastal Walk"]["highway"](-33.95,151.25,-33.88,151.30);`,
    type: 'Run' as const,
    region: 'Sydney, Australia',
    maxPoints: 200,
  },
  // Alpine hiking
  {
    name: 'Tour du Mont Blanc Section',
    query: `relation["name"~"Tour du Mont Blanc"]["route"="hiking"](45.8,6.8,46.0,7.0);`,
    type: 'Hike' as const,
    region: 'Alps (France/Italy)',
    maxPoints: 400,
  },
  // Swimming - using ferry routes as proxy for open water
  {
    name: 'English Channel Crossing',
    query: `relation["route"="ferry"]["name"~"Dover.*Calais|Calais.*Dover"](50.8,-0.5,51.2,2.0);`,
    type: 'Swim' as const,
    region: 'English Channel',
    maxPoints: 100,
  },
];

// Fallback routes using bbox queries for when named routes fail
const FALLBACK_QUERIES = [
  // Cycling paths in popular areas
  {
    name: 'Amsterdam Cycling Path',
    query: `way["highway"="cycleway"](52.35,4.85,52.40,4.95);`,
    type: 'Ride' as const,
    region: 'Amsterdam, Netherlands',
    maxPoints: 300,
  },
  {
    name: 'Copenhagen Bike Route',
    query: `way["highway"="cycleway"](55.66,12.55,55.70,12.60);`,
    type: 'Ride' as const,
    region: 'Copenhagen, Denmark',
    maxPoints: 300,
  },
  {
    name: 'Central Park Loop',
    query: `way["highway"]["name"~"Park Drive|East Drive|West Drive"](40.76,-73.98,40.80,-73.95);`,
    type: 'Run' as const,
    region: 'New York, USA',
    maxPoints: 250,
  },
  {
    name: 'Hyde Park Serpentine',
    query: `way["leisure"="track"]["sport"="running"](51.50,-0.18,51.52,-0.15);`,
    type: 'Run' as const,
    region: 'London, UK',
    maxPoints: 200,
  },
  {
    name: 'Lake Zurich Promenade',
    query: `way["highway"~"footway|path"]["name"~"Seeufer|Promenade"](47.35,8.52,47.38,8.56);`,
    type: 'Run' as const,
    region: 'Zurich, Switzerland',
    maxPoints: 200,
  },
  // Swimming fallbacks - coastal paths
  {
    name: 'Dover Harbour to Beach',
    query: `way["highway"~"footway|path"](51.10,1.30,51.13,1.35);`,
    type: 'Swim' as const,
    region: 'Dover, UK',
    maxPoints: 100,
  },
];

// Ramer-Douglas-Peucker Algorithm
function perpendicularDistance(
  point: Coordinate,
  lineStart: Coordinate,
  lineEnd: Coordinate
): number {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;

  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      Math.pow(point.lng - lineStart.lng, 2) +
        Math.pow(point.lat - lineStart.lat, 2)
    );
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) /
        (dx * dx + dy * dy)
    )
  );

  const projX = lineStart.lng + t * dx;
  const projY = lineStart.lat + t * dy;

  return Math.sqrt(
    Math.pow(point.lng - projX, 2) + Math.pow(point.lat - projY, 2)
  );
}

function rdpSimplify(points: Coordinate[], epsilon: number): Coordinate[] {
  if (points.length < 3) return points;

  let maxDist = 0;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(
      points[i],
      points[0],
      points[points.length - 1]
    );
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

function simplifyToTargetPoints(
  points: Coordinate[],
  targetPoints: number
): Coordinate[] {
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

// Haversine distance calculation
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
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

function calculateDistance(coords: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineDistance(
      coords[i - 1].lat,
      coords[i - 1].lng,
      coords[i].lat,
      coords[i].lng
    );
  }
  return Math.round(total);
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

// Extract coordinates from Overpass response
function extractCoordinates(elements: OverpassElement[]): Coordinate[] {
  const coords: Coordinate[] = [];

  for (const element of elements) {
    if (element.geometry) {
      for (const point of element.geometry) {
        coords.push({ lat: point.lat, lng: point.lon });
      }
    }
    if (element.members) {
      for (const member of element.members) {
        if (member.geometry) {
          for (const point of member.geometry) {
            coords.push({ lat: point.lat, lng: point.lon });
          }
        }
      }
    }
  }

  return coords;
}

// Remove duplicate consecutive points
function deduplicateCoords(coords: Coordinate[]): Coordinate[] {
  return coords.filter(
    (coord, i) =>
      i === 0 ||
      coord.lat !== coords[i - 1].lat ||
      coord.lng !== coords[i - 1].lng
  );
}

// Main function
async function main() {
  console.log('Preparing demo routes from OpenStreetMap...\n');
  console.log('Data source: OpenStreetMap (ODbL License)');
  console.log('Attribution: "© OpenStreetMap contributors"\n');

  const routes: DemoRoute[] = [];
  let idCounter = 1;

  // Try primary routes first
  const allQueries = [...ROUTES_TO_FETCH, ...FALLBACK_QUERIES];

  for (const routeDef of allQueries) {
    console.log(`Fetching: ${routeDef.name}`);

    try {
      const response = await fetchOverpass(routeDef.query);

      if (response.elements.length === 0) {
        console.log(`  No data found, skipping.`);
        continue;
      }

      let coords = extractCoordinates(response.elements);
      coords = deduplicateCoords(coords);

      if (coords.length < 20) {
        console.log(`  Too few points (${coords.length}), skipping.`);
        continue;
      }

      console.log(`  Found ${coords.length} points`);

      // Simplify to target points
      const simplified = simplifyToTargetPoints(coords, routeDef.maxPoints);
      const distance = calculateDistance(simplified);

      // Skip if too short
      if (distance < 1000) {
        console.log(`  Too short (${distance}m), skipping.`);
        continue;
      }

      routes.push({
        id: `route-osm-${idCounter++}`,
        name: routeDef.name,
        type: routeDef.type,
        coordinates: simplified.map((c) => [c.lat, c.lng]),
        distance,
        elevation: 0, // Would need elevation API for accurate data
        region: routeDef.region,
        attribution: ATTRIBUTION,
      });

      console.log(
        `  Added: ${simplified.length} points, ${(distance / 1000).toFixed(1)} km`
      );

      // Rate limiting - be nice to the API
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.log(`  Error: ${error instanceof Error ? error.message : error}`);
    }

    // Stop if we have enough routes
    if (routes.length >= 15) {
      console.log('\nReached target route count.');
      break;
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total routes: ${routes.length}`);
  console.log(`  Cycling: ${routes.filter((r) => r.type === 'Ride').length}`);
  console.log(`  Running: ${routes.filter((r) => r.type === 'Run').length}`);
  console.log(`  Hiking: ${routes.filter((r) => r.type === 'Hike').length}`);
  console.log(`  Swimming: ${routes.filter((r) => r.type === 'Swim').length}`);

  if (routes.length === 0) {
    console.log('\n No routes fetched. Check network connection and try again.');
    return;
  }

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
    console.log(`  ${route.name} (${route.type}) - ${route.region}`);
    console.log(
      `    ${route.coordinates.length} points, ${(route.distance / 1000).toFixed(1)} km`
    );
  }
}

main().catch(console.error);
