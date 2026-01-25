/**
 * Demo data fixtures that match the Intervals.icu API response format exactly.
 *
 * These fixtures can be used for:
 * - Demo mode in the app
 * - End-to-end testing
 * - Unit testing API consumers
 *
 * The data structure matches what the real API returns, ensuring the app
 * handles demo data the same way it handles real data.
 */

import { demoRoutes, getRouteBounds, getRouteCoordinates, getRouteLocation } from './routes';
import {
  getDemoReferenceDate,
  formatDateId,
  formatLocalISOString,
  generateActivityId,
  createDateSeededRandom,
  createActivitySeededRandom,
  isRestDay,
  getTimeOfDay,
} from './random';

// ============================================================================
// TYPES (matching API responses)
// ============================================================================

export interface ApiActivity {
  id: string;
  start_date_local: string;
  type: string;
  name: string;
  description: string | null;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  total_elevation_loss: number;
  average_speed: number;
  max_speed: number;
  average_heartrate: number | null;
  max_heartrate: number | null;
  average_cadence: number | null;
  average_temp: number | null;
  calories: number;
  device_name: string;
  trainer: boolean;
  commute: boolean;
  icu_training_load: number | null;
  icu_intensity: number | null;
  icu_ftp: number | null;
  icu_atl: number;
  icu_ctl: number;
  icu_hr_zones: number[];
  icu_power_zones: number[];
  stream_types: string[];
  locality: string | null;
  country: string | null;
}

export interface ApiWellness {
  id: string; // date string YYYY-MM-DD
  ctl: number;
  atl: number;
  rampRate: number;
  ctlLoad: number;
  atlLoad: number;
  sportInfo: Array<{
    type: string;
    eftp: number;
    wPrime: number;
    pMax: number;
  }>;
  weight: number | null;
  restingHR: number | null;
  hrv: number | null;
  hrvSDNN: number | null;
  sleepSecs: number | null;
  sleepScore: number | null;
  sleepQuality: number | null;
  steps: number | null;
  vo2max: number | null;
}

export interface ApiActivityMap {
  bounds: [[number, number], [number, number]];
  latlngs: [number, number][] | null;
  route: null;
  weather: null;
}

export interface ApiActivityStreams {
  time: number[];
  latlng?: [number, number][];
  heartrate?: number[];
  watts?: number[];
  altitude?: number[];
  fixed_altitude?: number[];
  cadence?: number[];
  distance?: number[];
  velocity_smooth?: number[];
  temp?: number[];
}

export interface ApiAthlete {
  id: string;
  name: string;
  profile_medium: string | null;
  locale: string;
  timezone: string;
  icu_weight: number;
  icu_ftp: number;
  icu_lthr: number;
  icu_max_hr: number;
  icu_resting_hr: number;
}

// ============================================================================
// FIXTURE GENERATORS
// ============================================================================

const DEMO_ATHLETE: ApiAthlete = {
  id: 'demo',
  name: 'Demo Athlete',
  profile_medium: null,
  locale: 'en-AU',
  timezone: 'Australia/Sydney',
  icu_weight: 75,
  icu_ftp: 250,
  icu_lthr: 165,
  icu_max_hr: 190,
  icu_resting_hr: 55,
};

/**
 * Generate activity name based on type, time of day, and workout style
 */
function generateActivityName(
  type: string,
  hour: number,
  isLong: boolean,
  isHard: boolean,
  routeId?: string | null
): string {
  const timeOfDay = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';

  switch (type) {
    case 'Ride':
      if (isLong) return `${timeOfDay} Endurance Ride`;
      if (isHard) return `${timeOfDay} Interval Ride`;
      return `${timeOfDay} Ride`;
    case 'Run':
      if (isLong) return `${timeOfDay} Long Run`;
      if (isHard) return `${timeOfDay} Tempo Run`;
      return `${timeOfDay} Run`;
    case 'VirtualRide':
      // Use route name for virtual rides
      if (routeId?.includes('grindelwald')) return `${timeOfDay} Virtual Ride - Swiss Alps`;
      if (routeId?.includes('lavaux')) return `${timeOfDay} Virtual Ride - Vineyards`;
      if (routeId?.includes('vuelta')) return `${timeOfDay} Virtual Ride - Stage Climb`;
      if (routeId?.includes('rio')) return `${timeOfDay} Virtual Ride - Coastal`;
      return `${timeOfDay} Virtual Ride`;
    case 'Swim':
      if (routeId) return `${timeOfDay} Open Water Swim`;
      return `${timeOfDay} Pool Swim`;
    case 'Hike':
      if (isLong) return `${timeOfDay} Mountain Hike`;
      return `${timeOfDay} Valley Hike`;
    case 'Walk':
      return `${timeOfDay} Walk`;
    default:
      return `${timeOfDay} ${type}`;
  }
}

/**
 * Generate a year of activities in API format
 * Uses deterministic random for reproducible data
 */
function generateActivities(): ApiActivity[] {
  const activities: ApiActivity[] = [];
  const referenceDate = getDemoReferenceDate();
  const activitiesPerDate = new Map<string, number>();

  // Route IDs from realRoutes.json (extracted from real activities):
  // Outdoor Cycling (Valais, Switzerland):
  //   route-valais-ride-1: Rhône Valley Ride (73km)
  //   route-valais-ride-2: Alpine Approach (29km)
  // Virtual Cycling:
  //   route-rouvy-grindelwald: Grindelwald to Lauterbrunnen (23km)
  //   route-rouvy-lavaux: Lavaux Vineyards (17km)
  //   route-rouvy-rio: Rio de Janeiro Aterro (10km)
  //   route-rouvy-vuelta: La Vuelta Stage 12 (21km)
  // Running (Rio de Janeiro, Brazil):
  //   route-rio-run-1 through route-rio-run-4 (3-15km)
  // Open Water Swimming (La Orotava, Tenerife):
  //   route-la-orotava-swim-1 through route-la-orotava-swim-4 (100-200m)
  // Hiking (Lauterbrunnen, Switzerland):
  //   route-lauterbrunnen-hike-1 through route-lauterbrunnen-hike-3 (0.7-10km)
  // Walking (Cape Town, South Africa):
  //   route-cape-town-walk-1 through route-cape-town-walk-8 (0.8-3km)

  const templates = [
    // === OUTDOOR CYCLING (Valais, Switzerland) ===
    {
      type: 'Ride',
      dist: 30000,
      time: 4500,
      elev: 150,
      speed: 24,
      hr: 145,
      watts: 180,
      tss: 65,
      route: 'route-valais-ride-2', // Alpine Approach (29km)
      isLong: false,
      isHard: false,
    },
    {
      type: 'Ride',
      dist: 75000,
      time: 10800,
      elev: 200,
      speed: 25,
      hr: 135,
      watts: 165,
      tss: 120,
      route: 'route-valais-ride-1', // Rhône Valley Ride (73km)
      isLong: true,
      isHard: false,
    },

    // === VIRTUAL CYCLING ===
    {
      type: 'VirtualRide',
      dist: 23000,
      time: 3600,
      elev: 270,
      speed: 23,
      hr: 150,
      watts: 195,
      tss: 55,
      route: 'route-rouvy-grindelwald', // Grindelwald to Lauterbrunnen (Swiss Alps)
      isLong: false,
      isHard: false,
    },
    {
      type: 'VirtualRide',
      dist: 17000,
      time: 2700,
      elev: 280,
      speed: 22,
      hr: 155,
      watts: 210,
      tss: 50,
      route: 'route-rouvy-lavaux', // Lavaux Vineyards (Lake Geneva)
      isLong: false,
      isHard: true,
    },
    {
      type: 'VirtualRide',
      dist: 21000,
      time: 3300,
      elev: 370,
      speed: 23,
      hr: 148,
      watts: 190,
      tss: 60,
      route: 'route-rouvy-vuelta', // La Vuelta Stage 12 (Spain)
      isLong: false,
      isHard: false,
    },

    // === RUNNING (Rio de Janeiro, Brazil) ===
    {
      type: 'Run',
      dist: 3000,
      time: 1200,
      elev: 20,
      speed: 9,
      hr: 140,
      watts: 0,
      tss: 25,
      route: 'route-rio-run-1', // Short Rio run
      isLong: false,
      isHard: false,
    },
    {
      type: 'Run',
      dist: 15000,
      time: 4800,
      elev: 50,
      speed: 11.2,
      hr: 145,
      watts: 0,
      tss: 70,
      route: 'route-rio-run-2', // Long Rio run (15km)
      isLong: true,
      isHard: false,
    },
    {
      type: 'Run',
      dist: 3000,
      time: 1100,
      elev: 15,
      speed: 9.8,
      hr: 155,
      watts: 0,
      tss: 30,
      route: 'route-rio-run-3', // Tempo Rio run
      isLong: false,
      isHard: true,
    },

    // === OPEN WATER SWIMMING (La Orotava, Tenerife) ===
    {
      type: 'Swim',
      dist: 2500,
      time: 3000,
      elev: 0,
      speed: 3,
      hr: 130,
      watts: 0,
      tss: 40,
      route: null, // Pool swim - no GPS
      isLong: false,
      isHard: false,
    },
    {
      type: 'Swim',
      dist: 500,
      time: 1200,
      elev: 0,
      speed: 1.5,
      hr: 135,
      watts: 0,
      tss: 25,
      route: 'route-la-orotava-swim-1', // Open water swim (Tenerife)
      isLong: false,
      isHard: false,
    },
    {
      type: 'Swim',
      dist: 400,
      time: 900,
      elev: 0,
      speed: 1.6,
      hr: 140,
      watts: 0,
      tss: 20,
      route: 'route-la-orotava-swim-3', // Open water swim (Tenerife)
      isLong: false,
      isHard: true,
    },

    // === HIKING (Lauterbrunnen, Switzerland) ===
    {
      type: 'Hike',
      dist: 10000,
      time: 14400,
      elev: 1000,
      speed: 2.5,
      hr: 115,
      watts: 0,
      tss: 80,
      route: 'route-lauterbrunnen-hike-3', // Long mountain hike (10km)
      isLong: true,
      isHard: false,
    },
    {
      type: 'Hike',
      dist: 1200,
      time: 2400,
      elev: 60,
      speed: 1.8,
      hr: 105,
      watts: 0,
      tss: 20,
      route: 'route-lauterbrunnen-hike-2', // Short valley hike
      isLong: false,
      isHard: false,
    },

    // === WALKING (Cape Town, South Africa) ===
    {
      type: 'Walk',
      dist: 3000,
      time: 2400,
      elev: 700,
      speed: 4.5,
      hr: 95,
      watts: 0,
      tss: 15,
      route: 'route-cape-town-walk-3', // Table Mountain walk
      isLong: false,
      isHard: false,
    },
    {
      type: 'Walk',
      dist: 2300,
      time: 1800,
      elev: 140,
      speed: 4.6,
      hr: 90,
      watts: 0,
      tss: 12,
      route: 'route-cape-town-walk-5', // Coastal walk
      isLong: false,
      isHard: false,
    },
  ];

  // Track CTL/ATL for realistic values
  let ctl = 35;
  let atl = 35;
  let lastRoute: string | null = null;

  // Helper to select a template from a range, avoiding the last used route (deterministic)
  const selectTemplate = (indices: number[], random: () => number): (typeof templates)[0] => {
    // Filter to templates with different routes than last used
    const candidates = indices.filter((i) => templates[i].route !== lastRoute);
    // If all have same route (shouldn't happen), fall back to original list
    const pool = candidates.length > 0 ? candidates : indices;
    return templates[pool[Math.floor(random() * pool.length)]];
  };

  for (let daysAgo = 365; daysAgo >= 0; daysAgo--) {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() - daysAgo);
    const dateStr = formatDateId(date);

    // Create date-seeded random for this day's activities
    const dayRandom = createDateSeededRandom(dateStr + '-activity');

    // Set time of day deterministically
    const timeOfDay = getTimeOfDay(dateStr);
    date.setHours(timeOfDay.hours, timeOfDay.minutes, 0, 0);

    // Seasonal variation
    const month = date.getMonth();
    const seasonMult =
      month >= 11 || month <= 1
        ? 0.7
        : month >= 2 && month <= 4
          ? 0.9
          : month >= 5 && month <= 7
            ? 1.15
            : 1.0;

    const dayOfWeek = date.getDay();

    // Rest days (deterministic)
    if (isRestDay(dateStr, dayOfWeek)) {
      // Update CTL/ATL even on rest days
      atl = atl + (0 - atl) / 7;
      ctl = ctl + (0 - ctl) / 42;
      continue;
    }

    // Select template based on day (using deterministic random)
    // Templates: 0-1=Ride, 2-4=VirtualRide, 5-7=Run, 8-10=Swim, 11-12=Hike, 13-14=Walk
    let template;
    if (dayOfWeek === 0) {
      // Sunday: Long activities - long ride, long run, or mountain hike
      const r = dayRandom();
      if (r < 0.4)
        template = selectTemplate([1], dayRandom); // Long ride
      else if (r < 0.7)
        template = selectTemplate([6], dayRandom); // Long run
      else template = selectTemplate([11], dayRandom); // Mountain hike
    } else if (dayOfWeek === 6) {
      // Saturday: Outdoor activities - rides, runs, hikes, or walks
      const r = dayRandom();
      if (r < 0.35)
        template = selectTemplate([0, 1], dayRandom); // Rides
      else if (r < 0.6)
        template = selectTemplate([5, 6, 7], dayRandom); // Runs
      else if (r < 0.8)
        template = selectTemplate([11, 12], dayRandom); // Hikes
      else template = selectTemplate([13, 14], dayRandom); // Walks
    } else if (dayOfWeek === 2 || dayOfWeek === 5) {
      // Tuesday/Friday: Indoor or short activities - runs, swims, virtual rides
      const r = dayRandom();
      if (r < 0.35)
        template = selectTemplate([5, 6, 7], dayRandom); // Runs
      else if (r < 0.55)
        template = selectTemplate([8, 9, 10], dayRandom); // Swims
      else template = selectTemplate([2, 3, 4], dayRandom); // Virtual rides
    } else {
      // Other weekdays: Mix of everything
      template = selectTemplate([...Array(templates.length).keys()], dayRandom);
    }

    const variance = (0.85 + dayRandom() * 0.3) * seasonMult;
    const tss = Math.round(template.tss * variance);

    // Update CTL/ATL
    atl = atl + (tss - atl) / 7;
    ctl = ctl + (tss - ctl) / 42;

    // Generate name based on type and time of day
    const hour = date.getHours();
    const activityName = generateActivityName(
      template.type,
      hour,
      template.isLong,
      template.isHard,
      template.route
    );

    // Get location from route
    const location = template.route
      ? getRouteLocation(template.route)
      : { locality: null, country: null };

    // Generate deterministic activity ID
    const indexOnDate = activitiesPerDate.get(dateStr) || 0;
    activitiesPerDate.set(dateStr, indexOnDate + 1);
    const activityId = generateActivityId(dateStr, indexOnDate);

    activities.push({
      id: activityId,
      start_date_local: formatLocalISOString(date),
      type: template.type,
      name: activityName,
      description: null,
      distance: Math.round(template.dist * variance),
      moving_time: Math.round(template.time * variance),
      elapsed_time: Math.round(template.time * variance * 1.05),
      total_elevation_gain: Math.round(template.elev * variance),
      total_elevation_loss: Math.round(template.elev * variance * 0.95),
      average_speed: template.speed * variance,
      max_speed: template.speed * variance * 1.3,
      average_heartrate: Math.round(template.hr * (0.95 + dayRandom() * 0.1)),
      max_heartrate: Math.round(template.hr * 1.2),
      average_cadence:
        template.type === 'Run'
          ? 85 + dayRandom() * 10
          : template.type === 'Ride'
            ? 85 + dayRandom() * 15
            : null,
      average_temp: 18 + dayRandom() * 10,
      calories: Math.round(tss * 8),
      device_name: 'Demo Device',
      trainer: template.type === 'VirtualRide',
      commute: false,
      icu_training_load: tss,
      icu_intensity: template.watts ? Math.round((template.watts / 250) * 100) : null,
      icu_ftp: 250,
      icu_atl: Math.round(atl * 10) / 10,
      icu_ctl: Math.round(ctl * 10) / 10,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      stream_types:
        template.type === 'Swim' && !template.route
          ? ['time', 'heartrate', 'distance'] // Pool swim - no GPS
          : template.type === 'Swim' && template.route
            ? ['time', 'latlng', 'heartrate', 'distance'] // Open water swim with GPS
            : template.type === 'VirtualRide' && template.route
              ? ['time', 'latlng', 'heartrate', 'altitude', 'cadence', 'watts', 'velocity_smooth'] // Virtual ride with GPS
              : template.type === 'VirtualRide'
                ? ['time', 'heartrate', 'altitude', 'cadence', 'watts', 'velocity_smooth'] // Virtual ride without GPS (fallback)
                : template.type === 'Ride'
                  ? [
                      'time',
                      'latlng',
                      'heartrate',
                      'altitude',
                      'cadence',
                      'watts',
                      'velocity_smooth',
                    ]
                  : template.type === 'Hike' || template.type === 'Walk'
                    ? ['time', 'latlng', 'heartrate', 'altitude'] // Hiking/walking
                    : ['time', 'latlng', 'heartrate', 'altitude', 'cadence', 'velocity_smooth'], // Running
      locality: location.locality,
      country: location.country,
      // Store route ID for map lookups (not part of real API)
      _routeId: template.route,
    } as ApiActivity & { _routeId: string | null });

    // Track last route to avoid consecutive duplicates
    lastRoute = template.route;
  }

  return activities;
}

/**
 * Generate a year of wellness data in API format
 * Uses deterministic random for reproducible data
 */
function generateWellness(): ApiWellness[] {
  const wellness: ApiWellness[] = [];
  const referenceDate = getDemoReferenceDate();

  let ctl = 35;
  let atl = 35;
  const baseWeight = 75;
  const baseRhr = 55;
  const baseHrv = 50;

  for (let daysAgo = 365; daysAgo >= 0; daysAgo--) {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() - daysAgo);
    const dateStr = formatDateId(date);

    // Create date-seeded random for this day's wellness
    const wellnessRandom = createDateSeededRandom(dateStr + '-wellness-fixture');

    // Seasonal target CTL
    const month = date.getMonth();
    const targetCtl =
      month >= 11 || month <= 1
        ? 35
        : month >= 2 && month <= 4
          ? 45
          : month >= 5 && month <= 7
            ? 55
            : 45;

    // Simulate daily load (deterministic)
    const dayOfWeek = date.getDay();
    const isRest = dayOfWeek === 1 || (dayOfWeek === 4 && wellnessRandom() < 0.5);
    const dailyTss = isRest
      ? 0
      : dayOfWeek === 0 || dayOfWeek === 6
        ? 80 + wellnessRandom() * 50
        : 40 + wellnessRandom() * 40;

    // Update CTL/ATL
    atl = atl + (dailyTss - atl) / 7;
    ctl = ctl + (dailyTss - ctl) / 42;
    ctl += (targetCtl - ctl) * 0.01;

    // Derived metrics (deterministic)
    const fatigueFactor = atl / 50;
    const rhr = Math.round(baseRhr + fatigueFactor * 5 + (wellnessRandom() - 0.5) * 4);
    const hrv = Math.round(baseHrv - fatigueFactor * 5 + (wellnessRandom() - 0.5) * 10);
    const sleepHours = 7 + (isRest ? 0.5 : 0) + (wellnessRandom() - 0.5) * 1.5;
    const sleepScore = Math.round(70 + (sleepHours - 6) * 10 + wellnessRandom() * 10);

    wellness.push({
      id: dateStr,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      rampRate: Math.round((ctl - (wellness[wellness.length - 1]?.ctl || ctl)) * 100) / 100,
      ctlLoad: Math.round(dailyTss),
      atlLoad: Math.round(dailyTss),
      sportInfo: [
        {
          type: 'Ride',
          eftp: 250 + Math.round((ctl - 40) * 1.5),
          wPrime: 15000,
          pMax: 800,
        },
        { type: 'Run', eftp: 300, wPrime: 20000, pMax: 600 },
      ],
      weight: Math.round((baseWeight + Math.sin(daysAgo * 0.1) * 1.5) * 10) / 10,
      restingHR: rhr,
      hrv: Math.max(20, Math.min(100, hrv)),
      hrvSDNN: Math.round(hrv * 1.2),
      sleepSecs: Math.round(sleepHours * 3600),
      sleepScore: Math.max(50, Math.min(100, sleepScore)),
      sleepQuality: sleepScore >= 80 ? 3 : sleepScore >= 60 ? 2 : 1,
      steps: Math.round((isRest ? 5000 : 10000) + wellnessRandom() * 5000),
      vo2max: 50 + (ctl - 40) * 0.1,
    });
  }

  return wellness;
}

// ============================================================================
// FIXTURE DATA (generated once on module load)
// ============================================================================

const generatedActivities = generateActivities();

export const fixtures = {
  athlete: DEMO_ATHLETE,
  activities: generatedActivities,
  wellness: generateWellness(),
};

// ============================================================================
// FIXTURE ACCESS FUNCTIONS
// ============================================================================

export function getActivity(id: string): ApiActivity | undefined {
  return fixtures.activities.find((a) => a.id === id);
}

export function getActivities(params?: { oldest?: string; newest?: string }): ApiActivity[] {
  let result = [...fixtures.activities];

  if (params?.oldest) {
    const oldest = new Date(params.oldest);
    result = result.filter((a) => new Date(a.start_date_local) >= oldest);
  }
  if (params?.newest) {
    const newest = new Date(params.newest);
    result = result.filter((a) => new Date(a.start_date_local) <= newest);
  }

  return result.reverse(); // Newest first
}

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
    const coords = getRouteCoordinates(routeId);
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

export function getActivityStreams(id: string): ApiActivityStreams | null {
  const activity = getActivity(id);
  if (!activity) return null;

  // Create activity-seeded random for reproducible stream data
  const streamRandom = createActivitySeededRandom(id + '-streams');

  const duration = activity.moving_time;
  const points = Math.min(Math.max(duration / 5, 100), 1000); // 100-1000 points, ~5 sec intervals
  const interval = Math.ceil(duration / points);

  const streams: ApiActivityStreams = {
    time: Array.from({ length: points }, (_, i) => i * interval),
  };

  // Heart rate stream - always include for activities with HR data
  const baseHr = activity.average_heartrate || 140; // Default to 140 if not set
  streams.heartrate = streams.time.map((t) => {
    const progress = t / duration;
    const warmup = Math.min(1, progress * 5); // Warmup effect
    const fatigue = progress * 5; // Cardiac drift
    const variation = (streamRandom() - 0.5) * 10;
    return Math.round(Math.max(80, Math.min(200, baseHr * 0.85 * warmup + fatigue + variation)));
  });

  // Power stream (for rides)
  if (activity.type === 'Ride' || activity.type === 'VirtualRide') {
    const ftp = activity.icu_ftp || 250;
    streams.watts = streams.time.map((t) => {
      const progress = t / duration;
      // Create some intervals/variability
      const intervalPhase = Math.sin(progress * Math.PI * 8) * 0.2;
      const base = ftp * (0.65 + intervalPhase);
      return Math.round(Math.max(50, base + (streamRandom() - 0.5) * ftp * 0.3));
    });
  }

  // GPS stream - only for outdoor activities with routes
  if (activity.stream_types?.includes('latlng')) {
    const map = getActivityMap(id, false);
    if (map?.latlngs && map.latlngs.length > 0) {
      // Interpolate to match time points
      const coords = map.latlngs;
      streams.latlng = streams.time.map((_, i) => {
        const idx = Math.min(Math.floor((i / points) * coords.length), coords.length - 1);
        return coords[idx];
      });
    }
  }

  // Altitude stream - generate realistic elevation profile
  if (activity.stream_types?.includes('altitude')) {
    const maxElev = activity.total_elevation_gain || 100;
    const baseAltitude = 50; // Starting altitude in meters

    // Create a more realistic elevation profile with multiple hills
    streams.altitude = streams.time.map((t) => {
      const progress = t / duration;
      // Multiple hills with different frequencies
      const hill1 = Math.sin(progress * Math.PI * 2) * (maxElev / 3);
      const hill2 = Math.sin(progress * Math.PI * 4 + 1) * (maxElev / 4);
      const hill3 = Math.sin(progress * Math.PI * 6 + 2) * (maxElev / 6);
      const noise = (streamRandom() - 0.5) * 5;
      return Math.round(Math.max(0, baseAltitude + hill1 + hill2 + hill3 + noise));
    });

    // Also create fixed_altitude (same as altitude for demo)
    streams.fixed_altitude = [...streams.altitude];
  }

  // Cadence stream - always include for cycling and running
  if (activity.type === 'Ride' || activity.type === 'VirtualRide') {
    const baseCadence = activity.average_cadence || 85;
    streams.cadence = streams.time.map((t) => {
      const progress = t / duration;
      // Simulate cadence variation (lower on climbs, higher on descents)
      const hillEffect = Math.sin(progress * Math.PI * 2) * 5;
      const variation = (streamRandom() - 0.5) * 8;
      return Math.round(Math.max(60, Math.min(120, baseCadence + hillEffect + variation)));
    });
  } else if (activity.type === 'Run') {
    const baseCadence = activity.average_cadence || 170; // Running cadence in spm
    streams.cadence = streams.time.map(() => {
      const variation = (streamRandom() - 0.5) * 6;
      return Math.round(Math.max(150, Math.min(190, baseCadence + variation)));
    });
  }

  // Velocity/speed stream
  if (activity.average_speed) {
    streams.velocity_smooth = streams.time.map((t) => {
      const progress = t / duration;
      // Slower on uphills, faster on downhills
      const hillEffect = -Math.sin(progress * Math.PI * 2) * (activity.average_speed * 0.15);
      const variation = (streamRandom() - 0.5) * 2;
      return Math.max(1, activity.average_speed + hillEffect + variation);
    });
  }

  // Distance stream - cumulative distance over time (required for charts)
  // This is the X-axis for most activity charts
  // Derived from velocity to ensure monotonically increasing values
  if (activity.distance && streams.velocity_smooth && streams.time.length > 1) {
    const totalDistance = activity.distance;
    // Calculate cumulative distance from velocity
    const rawDistance: number[] = [0];
    for (let i = 1; i < streams.time.length; i++) {
      const dt = streams.time[i] - streams.time[i - 1];
      const avgVelocity = (streams.velocity_smooth[i] + streams.velocity_smooth[i - 1]) / 2;
      rawDistance.push(rawDistance[i - 1] + avgVelocity * dt);
    }
    // Scale to match actual total distance
    const calculatedTotal = rawDistance[rawDistance.length - 1];
    const scale = calculatedTotal > 0 ? totalDistance / calculatedTotal : 1;
    streams.distance = rawDistance.map((d) => Math.round(d * scale));
  } else if (activity.distance) {
    // Fallback: linear distance progression
    const totalDistance = activity.distance;
    streams.distance = streams.time.map((t) => {
      const progress = t / duration;
      return Math.round(totalDistance * progress);
    });
  }

  return streams;
}

export function getWellness(params?: { oldest?: string; newest?: string }): ApiWellness[] {
  let result = [...fixtures.wellness];

  if (params?.oldest) {
    result = result.filter((w) => w.id >= params.oldest!);
  }
  if (params?.newest) {
    result = result.filter((w) => w.id <= params.newest!);
  }

  return result;
}
