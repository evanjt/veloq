/**
 * Demo GPS route templates
 *
 * These are synthetic routes designed to look realistic.
 * Routes are based on common cycling/running patterns but don't represent
 * any real user's actual GPS data.
 */

export interface DemoRoute {
  id: string;
  name: string;
  type: 'Ride' | 'Run' | 'VirtualRide';
  coordinates: [number, number][]; // [lat, lng][]
  distance: number; // meters
  elevation: number; // meters gained
}

/**
 * Generate a smooth curve between points using bezier interpolation
 */
function interpolatePoints(
  points: [number, number][],
  density: number = 10
): [number, number][] {
  const result: [number, number][] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const [lat1, lng1] = points[i];
    const [lat2, lng2] = points[i + 1];

    for (let j = 0; j < density; j++) {
      const t = j / density;
      // Add slight curve variation for realism
      const curve = Math.sin(t * Math.PI) * 0.0001 * (Math.random() - 0.5);
      result.push([
        lat1 + (lat2 - lat1) * t + curve,
        lng1 + (lng2 - lng1) * t + curve * 0.5,
      ]);
    }
  }
  result.push(points[points.length - 1]);

  return result;
}

/**
 * Add GPS noise to make routes look more realistic
 */
function addGpsNoise(
  coords: [number, number][],
  amount: number = 0.00002
): [number, number][] {
  return coords.map(([lat, lng]) => [
    lat + (Math.random() - 0.5) * amount,
    lng + (Math.random() - 0.5) * amount,
  ]);
}

// Demo location: Fictional "Coastal City" - inspired by Australian geography
// Base coordinates around -33.9, 151.2 (Sydney-like area)

/**
 * Route 1: Coastal Loop Ride - 45km loop along coast
 */
const coastalLoopWaypoints: [number, number][] = [
  [-33.890, 151.200], // Start/End - City center
  [-33.885, 151.210], // East along beach road
  [-33.875, 151.225], // North coastal headland
  [-33.860, 151.235], // Continue north
  [-33.850, 151.230], // Turn inland
  [-33.855, 151.210], // West through suburbs
  [-33.865, 151.195], // Southwest
  [-33.880, 151.185], // South through park
  [-33.890, 151.200], // Back to start
];

/**
 * Route 2: Hill Climb Loop - 35km with significant climbing
 */
const hillClimbWaypoints: [number, number][] = [
  [-33.890, 151.200], // Start - City
  [-33.900, 151.190], // Southwest to foothills
  [-33.915, 151.175], // Climb up ridge
  [-33.925, 151.160], // Summit area
  [-33.920, 151.145], // Descend west side
  [-33.905, 151.155], // Loop back east
  [-33.895, 151.175], // Through valley
  [-33.890, 151.200], // Return
];

/**
 * Route 3: Riverside Run - 8km out and back
 */
const riversideRunWaypoints: [number, number][] = [
  [-33.890, 151.200], // Start
  [-33.888, 151.205], // Along river path
  [-33.882, 151.212], // Riverside park
  [-33.875, 151.218], // Turnaround point
  [-33.882, 151.212], // Back through park
  [-33.888, 151.205], // Return path
  [-33.890, 151.200], // End
];

/**
 * Route 4: Long Endurance Ride - 80km loop
 */
const enduranceLoopWaypoints: [number, number][] = [
  [-33.890, 151.200], // Start
  [-33.880, 151.220], // East to coast
  [-33.860, 151.250], // North along coast
  [-33.830, 151.260], // Further north
  [-33.810, 151.240], // Inland turn
  [-33.820, 151.200], // West
  [-33.840, 151.160], // Southwest
  [-33.870, 151.140], // South
  [-33.900, 151.160], // Southeast
  [-33.890, 151.200], // Return
];

/**
 * Route 5: Trail Run - 15km through parks
 */
const trailRunWaypoints: [number, number][] = [
  [-33.890, 151.200], // Start
  [-33.895, 151.195], // South park entrance
  [-33.905, 151.185], // Deep in park
  [-33.915, 151.190], // Trail junction
  [-33.910, 151.205], // East trail
  [-33.900, 151.210], // Loop back
  [-33.890, 151.200], // End
];

// Generate interpolated routes
export const demoRoutes: DemoRoute[] = [
  {
    id: 'route-coastal-loop',
    name: 'Coastal Loop',
    type: 'Ride',
    coordinates: addGpsNoise(interpolatePoints(coastalLoopWaypoints, 50)),
    distance: 45000,
    elevation: 450,
  },
  {
    id: 'route-hill-climb',
    name: 'Hill Climb Circuit',
    type: 'Ride',
    coordinates: addGpsNoise(interpolatePoints(hillClimbWaypoints, 40)),
    distance: 35000,
    elevation: 650,
  },
  {
    id: 'route-riverside',
    name: 'Riverside Path',
    type: 'Run',
    coordinates: addGpsNoise(interpolatePoints(riversideRunWaypoints, 30)),
    distance: 8000,
    elevation: 50,
  },
  {
    id: 'route-endurance',
    name: 'Grand Loop',
    type: 'Ride',
    coordinates: addGpsNoise(interpolatePoints(enduranceLoopWaypoints, 80)),
    distance: 80000,
    elevation: 800,
  },
  {
    id: 'route-trail',
    name: 'Park Trail',
    type: 'Run',
    coordinates: addGpsNoise(interpolatePoints(trailRunWaypoints, 40)),
    distance: 15000,
    elevation: 120,
  },
];

/**
 * Get a route's coordinates with optional variation
 */
export function getRouteCoordinates(
  routeId: string,
  addVariation: boolean = true
): [number, number][] {
  const route = demoRoutes.find(r => r.id === routeId);
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
export function getRouteBounds(
  coords: [number, number][]
): [[number, number], [number, number]] {
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  for (const [lat, lng] of coords) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }

  return [[minLat, minLng], [maxLat, maxLng]];
}

/**
 * Map activity template to a route
 */
export function getRouteForActivity(activityType: string, distance: number): DemoRoute | null {
  // Match by type and approximate distance
  const routes = demoRoutes.filter(r => {
    if (activityType === 'Run' && r.type !== 'Run') return false;
    if ((activityType === 'Ride' || activityType === 'VirtualRide') && r.type !== 'Ride') return false;
    // Allow 20% distance variance
    const ratio = r.distance / distance;
    return ratio > 0.8 && ratio < 1.2;
  });

  if (routes.length === 0) {
    // Fall back to any route of the right type
    return demoRoutes.find(r =>
      (activityType === 'Run' && r.type === 'Run') ||
      ((activityType === 'Ride' || activityType === 'VirtualRide') && r.type === 'Ride')
    ) || null;
  }

  return routes[Math.floor(Math.random() * routes.length)];
}
