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

import type { ActivityInterval, IntervalsDTO, ActivityIntervalGroup } from '@/types';
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
  average_watts: number | null;
  weighted_average_watts: number | null;
  icu_hr_zones: number[];
  icu_power_zones: number[];
  icu_zone_times: Array<{ id: string; secs: number }> | null;
  stream_types: string[];
  locality: string | null;
  country: string | null;
  skyline_chart_bytes?: string;
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
  grade_smooth?: number[];
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
// SKYLINE CHART ENCODER (protobuf for demo activities)
// ============================================================================

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return bytes;
}

function encodePacked(fieldNumber: number, values: number[]): number[] {
  const payload: number[] = [];
  for (const v of values) payload.push(...encodeVarint(v));
  return [...encodeVarint((fieldNumber << 3) | 2), ...encodeVarint(payload.length), ...payload];
}

/**
 * Generate skyline_chart_bytes from zone time distribution.
 * Splits zone time into plausible interval blocks.
 */
function generateSkylineBytes(
  zoneTimes: Array<{ id: string; secs: number }> | null,
  hrZoneTimes: number[] | null,
  random: () => number
): string | undefined {
  // Power-based skyline
  if (zoneTimes) {
    const intervals: Array<{ duration: number; zone: number; intensity: number }> = [];
    for (const zt of zoneTimes) {
      if (zt.secs < 10) continue;
      const zoneNum = parseInt(zt.id.replace('Z', ''), 10);
      // Split zone time into 1-3 blocks
      const blocks = Math.max(1, Math.min(3, Math.floor(zt.secs / 120)));
      const blockDur = Math.round(zt.secs / blocks);
      for (let b = 0; b < blocks; b++) {
        const dur = b === blocks - 1 ? zt.secs - blockDur * (blocks - 1) : blockDur;
        const intensity = [55, 75, 88, 100, 115, 130, 160][zoneNum - 1] ?? 100;
        intervals.push({
          duration: dur,
          zone: zoneNum,
          intensity: Math.round(intensity + (random() - 0.5) * 10),
        });
      }
    }
    // Shuffle deterministically
    for (let i = intervals.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [intervals[i], intervals[j]] = [intervals[j], intervals[i]];
    }
    if (intervals.length === 0) return undefined;
    const bytes = [
      ...encodeVarint((1 << 3) | 0),
      ...encodeVarint(7), // field 1: num zones
      ...encodePacked(
        2,
        intervals.map((i) => i.duration)
      ),
      ...encodePacked(
        3,
        intervals.map((i) => i.intensity)
      ),
      ...encodePacked(
        4,
        intervals.map((i) => i.zone)
      ),
      ...encodeVarint((5 << 3) | 0),
      ...encodeVarint(1), // field 5: power basis
    ];
    return btoa(String.fromCharCode(...bytes));
  }
  // HR-based skyline
  if (hrZoneTimes) {
    const intervals: Array<{ duration: number; zone: number; intensity: number }> = [];
    for (let z = 0; z < hrZoneTimes.length; z++) {
      if (hrZoneTimes[z] < 10) continue;
      const zoneNum = z + 1;
      const blocks = Math.max(1, Math.min(2, Math.floor(hrZoneTimes[z] / 180)));
      const blockDur = Math.round(hrZoneTimes[z] / blocks);
      for (let b = 0; b < blocks; b++) {
        const dur = b === blocks - 1 ? hrZoneTimes[z] - blockDur * (blocks - 1) : blockDur;
        intervals.push({ duration: dur, zone: zoneNum, intensity: 60 + zoneNum * 10 });
      }
    }
    for (let i = intervals.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [intervals[i], intervals[j]] = [intervals[j], intervals[i]];
    }
    if (intervals.length === 0) return undefined;
    const bytes = [
      ...encodeVarint((1 << 3) | 0),
      ...encodeVarint(5), // field 1: 5 HR zones
      ...encodePacked(
        2,
        intervals.map((i) => i.duration)
      ),
      ...encodePacked(
        3,
        intervals.map((i) => i.intensity)
      ),
      ...encodePacked(
        4,
        intervals.map((i) => i.zone)
      ),
      ...encodeVarint((5 << 3) | 0),
      ...encodeVarint(2), // field 5: HR basis
    ];
    return btoa(String.fromCharCode(...bytes));
  }
  return undefined;
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
  let globalActivityIndex = 0; // Global index for simple demo-N IDs

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

    // Generate deterministic activity ID using global index
    const activityId = generateActivityId(dateStr, globalActivityIndex);
    globalActivityIndex++;

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
      average_watts: template.watts ? Math.round(template.watts * variance) : null,
      weighted_average_watts: template.watts
        ? Math.round(template.watts * variance * (1.03 + dayRandom() * 0.07))
        : null,
      icu_training_load: tss,
      icu_intensity: template.watts ? Math.round((template.watts / 250) * 100) : null,
      icu_ftp: 250,
      icu_atl: Math.round(atl * 10) / 10,
      icu_ctl: Math.round(ctl * 10) / 10,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: template.watts
        ? (() => {
            const totalSecs = Math.round(template.time * variance);
            return [
              { id: 'Z1', secs: Math.round(totalSecs * 0.1) },
              { id: 'Z2', secs: Math.round(totalSecs * 0.35) },
              { id: 'Z3', secs: Math.round(totalSecs * 0.25) },
              { id: 'Z4', secs: Math.round(totalSecs * 0.15) },
              { id: 'Z5', secs: Math.round(totalSecs * 0.1) },
              { id: 'Z6', secs: Math.round(totalSecs * 0.04) },
              { id: 'Z7', secs: Math.round(totalSecs * 0.01) },
            ];
          })()
        : null,
      stream_types:
        template.type === 'Swim' && !template.route
          ? ['time', 'heartrate', 'distance'] // Pool swim - no GPS
          : template.type === 'Swim' && template.route
            ? ['time', 'latlng', 'heartrate', 'distance'] // Open water swim with GPS
            : template.type === 'VirtualRide' && template.route
              ? [
                  'time',
                  'latlng',
                  'heartrate',
                  'altitude',
                  'cadence',
                  'watts',
                  'velocity_smooth',
                  'grade_smooth',
                ] // Virtual ride with GPS
              : template.type === 'VirtualRide'
                ? [
                    'time',
                    'heartrate',
                    'altitude',
                    'cadence',
                    'watts',
                    'velocity_smooth',
                    'grade_smooth',
                  ] // Virtual ride without GPS (fallback)
                : template.type === 'Ride'
                  ? [
                      'time',
                      'latlng',
                      'heartrate',
                      'altitude',
                      'cadence',
                      'watts',
                      'velocity_smooth',
                      'grade_smooth',
                    ]
                  : template.type === 'Hike' || template.type === 'Walk'
                    ? ['time', 'latlng', 'heartrate', 'altitude', 'grade_smooth'] // Hiking/walking
                    : [
                        'time',
                        'latlng',
                        'heartrate',
                        'altitude',
                        'cadence',
                        'velocity_smooth',
                        'grade_smooth',
                      ], // Running
      locality: location.locality,
      country: location.country,
      // Store route ID for map lookups (not part of real API)
      _routeId: template.route,
    } as ApiActivity & { _routeId: string | null });

    // Generate skyline bytes for the activity we just pushed
    const pushed = activities[activities.length - 1];
    const hrZoneSecs = !template.watts
      ? (() => {
          const totalSecs = Math.round(template.time * variance);
          return [
            Math.round(totalSecs * 0.15),
            Math.round(totalSecs * 0.35),
            Math.round(totalSecs * 0.3),
            Math.round(totalSecs * 0.15),
            Math.round(totalSecs * 0.05),
          ];
        })()
      : null;
    pushed.skyline_chart_bytes = generateSkylineBytes(
      pushed.icu_zone_times,
      hrZoneSecs,
      createActivitySeededRandom(pushed.id)
    );

    // Track last route to avoid consecutive duplicates
    lastRoute = template.route;
  }

  // === STRESS TEST: High-traversal section ===
  // Add 200 short runs on the same route to test section detail at scale.
  // All use identical GPS coordinates so section detection groups them together.
  const stressRoute = templates[5]; // route-rio-run-1 (3km short run)
  const stressLocation = getRouteLocation(stressRoute.route!);
  for (let i = 0; i < 200; i++) {
    const daysAgo = Math.floor((i / 200) * 365);
    const date = new Date(referenceDate);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(6, 30, 0, 0);
    const activityId = `demo-stress-${i}`;

    activities.push({
      id: activityId,
      start_date_local: formatLocalISOString(date),
      type: stressRoute.type,
      name: `Morning Run #${i + 1}`,
      description: null,
      distance: stressRoute.dist + (i % 10) * 50,
      moving_time: stressRoute.time + (i % 10) * 20,
      elapsed_time: Math.round(stressRoute.time * 1.05) + (i % 10) * 20,
      total_elevation_gain: stressRoute.elev,
      total_elevation_loss: Math.round(stressRoute.elev * 0.95),
      average_speed: stressRoute.speed * (0.95 + (i % 5) * 0.02),
      max_speed: stressRoute.speed * 1.3,
      average_heartrate: stressRoute.hr + (i % 8) - 4,
      max_heartrate: Math.round(stressRoute.hr * 1.2),
      average_cadence: 85 + (i % 10),
      average_temp: 22,
      calories: stressRoute.tss * 8,
      device_name: 'Demo Device',
      trainer: false,
      commute: true,
      average_watts: null,
      weighted_average_watts: null,
      icu_training_load: stressRoute.tss,
      icu_intensity: null,
      icu_ftp: 250,
      icu_atl: 35,
      icu_ctl: 35,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: null,
      stream_types: [
        'time',
        'latlng',
        'heartrate',
        'altitude',
        'cadence',
        'velocity_smooth',
        'grade_smooth',
      ],
      locality: stressLocation.locality,
      country: stressLocation.country,
      _routeId: stressRoute.route,
    } as ApiActivity & { _routeId: string | null });
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
// STABLE TEST ACTIVITIES (permanent IDs for e2e tests)
// ============================================================================

/**
 * Generate stable test activities with permanent IDs for e2e testing.
 * These IDs never change regardless of the reference date.
 * Format: demo-test-N where N is 0-based index
 */
function generateStableTestActivities(): (ApiActivity & { _routeId: string | null })[] {
  const referenceDate = getDemoReferenceDate();

  // Create activities for recent days with stable IDs
  const stableActivities: (ApiActivity & { _routeId: string | null })[] = [
    // demo-test-0: Yesterday's ride
    {
      id: 'demo-test-0',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 1);
        d.setHours(8, 30, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'Ride',
      name: 'Morning Alpine Ride',
      description:
        "Great conditions today! Rode up through the valley with fresh legs after yesterday's rest day. Hit some good power numbers on the main climb and the descent was fast. Roads were dry and mostly empty.",
      distance: 45000,
      moving_time: 5400,
      elapsed_time: 5700,
      total_elevation_gain: 850,
      total_elevation_loss: 820,
      average_speed: 8.3,
      max_speed: 14.2,
      average_heartrate: 142,
      max_heartrate: 168,
      average_cadence: 88,
      average_temp: 18,
      calories: 1200,
      device_name: 'Demo Device',
      trainer: false,
      commute: false,
      average_watts: 195,
      weighted_average_watts: 208,
      icu_training_load: 85,
      icu_intensity: 78,
      icu_ftp: 250,
      icu_atl: 45,
      icu_ctl: 42,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: [
        { id: 'Z1', secs: 540 },
        { id: 'Z2', secs: 1890 },
        { id: 'Z3', secs: 1350 },
        { id: 'Z4', secs: 810 },
        { id: 'Z5', secs: 540 },
        { id: 'Z6', secs: 216 },
        { id: 'Z7', secs: 54 },
      ],
      stream_types: [
        'time',
        'latlng',
        'heartrate',
        'altitude',
        'cadence',
        'watts',
        'velocity_smooth',
        'grade_smooth',
      ],
      locality: 'Valais',
      country: 'Switzerland',
      _routeId: 'route-valais-ride-2',
    },
    // demo-test-1: 2 days ago run
    {
      id: 'demo-test-1',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 2);
        d.setHours(7, 0, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'Run',
      name: 'Easy Morning Run',
      description:
        'Recovery run along the beachfront. Kept the pace easy and HR in zone 2. Legs felt a bit heavy from the ride but loosened up after the first km.',
      distance: 8500,
      moving_time: 2700,
      elapsed_time: 2850,
      total_elevation_gain: 45,
      total_elevation_loss: 42,
      average_speed: 3.15,
      max_speed: 4.2,
      average_heartrate: 138,
      max_heartrate: 155,
      average_cadence: 172,
      average_temp: 16,
      calories: 520,
      device_name: 'Demo Device',
      trainer: false,
      commute: false,
      average_watts: null,
      weighted_average_watts: null,
      icu_training_load: 42,
      icu_intensity: 65,
      icu_ftp: 250,
      icu_atl: 48,
      icu_ctl: 41,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: null,
      stream_types: [
        'time',
        'latlng',
        'heartrate',
        'altitude',
        'cadence',
        'velocity_smooth',
        'grade_smooth',
      ],
      locality: 'Rio de Janeiro',
      country: 'Brazil',
      _routeId: 'route-rio-run-1',
    },
    // demo-test-2: 3 days ago virtual ride
    {
      id: 'demo-test-2',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 3);
        d.setHours(18, 30, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'VirtualRide',
      name: 'Evening Virtual Ride - Swiss Alps',
      description:
        'Virtual ride through Grindelwald. Focused on threshold intervals on the climb sections. The scenery helps with motivation on the harder efforts.',
      distance: 25000,
      moving_time: 3600,
      elapsed_time: 3650,
      total_elevation_gain: 650,
      total_elevation_loss: 620,
      average_speed: 6.9,
      max_speed: 11.5,
      average_heartrate: 155,
      max_heartrate: 175,
      average_cadence: 82,
      average_temp: 20,
      calories: 780,
      device_name: 'Demo Device',
      trainer: true,
      commute: false,
      average_watts: 205,
      weighted_average_watts: 218,
      icu_training_load: 72,
      icu_intensity: 82,
      icu_ftp: 250,
      icu_atl: 52,
      icu_ctl: 40,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: [
        { id: 'Z1', secs: 360 },
        { id: 'Z2', secs: 1260 },
        { id: 'Z3', secs: 900 },
        { id: 'Z4', secs: 540 },
        { id: 'Z5', secs: 360 },
        { id: 'Z6', secs: 144 },
        { id: 'Z7', secs: 36 },
      ],
      stream_types: [
        'time',
        'latlng',
        'heartrate',
        'altitude',
        'cadence',
        'watts',
        'velocity_smooth',
        'grade_smooth',
      ],
      locality: 'Grindelwald',
      country: 'Switzerland',
      _routeId: 'route-rouvy-grindelwald',
    },
    // demo-test-3: 4 days ago hike
    {
      id: 'demo-test-3',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 4);
        d.setHours(9, 0, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'Hike',
      name: 'Mountain Valley Hike',
      description: null,
      distance: 6500,
      moving_time: 7200,
      elapsed_time: 8100,
      total_elevation_gain: 380,
      total_elevation_loss: 350,
      average_speed: 0.9,
      max_speed: 1.4,
      average_heartrate: 115,
      max_heartrate: 142,
      average_cadence: null,
      average_temp: 14,
      calories: 450,
      device_name: 'Demo Device',
      trainer: false,
      commute: false,
      average_watts: null,
      weighted_average_watts: null,
      icu_training_load: 35,
      icu_intensity: 55,
      icu_ftp: 250,
      icu_atl: 42,
      icu_ctl: 39,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: null,
      stream_types: ['time', 'latlng', 'heartrate', 'altitude', 'grade_smooth'],
      locality: 'Lauterbrunnen',
      country: 'Switzerland',
      _routeId: 'route-lauterbrunnen-hike-2',
    },
    // demo-test-4: 5 days ago swim
    {
      id: 'demo-test-4',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 5);
        d.setHours(7, 30, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'Swim',
      name: 'Open Water Swim',
      description: null,
      distance: 2000,
      moving_time: 2400,
      elapsed_time: 2700,
      total_elevation_gain: 0,
      total_elevation_loss: 0,
      average_speed: 0.83,
      max_speed: 1.1,
      average_heartrate: 135,
      max_heartrate: 158,
      average_cadence: null,
      average_temp: 22,
      calories: 380,
      device_name: 'Demo Device',
      trainer: false,
      commute: false,
      average_watts: null,
      weighted_average_watts: null,
      icu_training_load: 45,
      icu_intensity: 70,
      icu_ftp: 250,
      icu_atl: 38,
      icu_ctl: 38,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: null,
      stream_types: ['time', 'latlng', 'heartrate', 'distance'],
      locality: 'La Orotava',
      country: 'Spain',
      _routeId: 'route-la-orotava-swim-1',
    },
  ];

  return stableActivities;
}

// ============================================================================
// FIXTURE DATA (generated once on module load)
// ============================================================================

const generatedActivities = generateActivities();
const stableActivities = generateStableTestActivities();

// Combine stable test activities (first) with generated activities
// Stable activities appear as most recent for e2e test reliability
export const fixtures = {
  athlete: DEMO_ATHLETE,
  activities: [...stableActivities, ...generatedActivities],
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

    // Grade stream - derivative of altitude over horizontal distance
    if (activity.stream_types?.includes('grade_smooth') && streams.altitude.length > 1) {
      const dist = activity.distance || 10000;
      const stepDist = dist / streams.altitude.length;
      streams.grade_smooth = streams.altitude.map((alt, i) => {
        if (i === 0) return 0;
        const dAlt = alt - streams.altitude![i - 1];
        const grade = (dAlt / stepDist) * 100;
        return Math.round(Math.max(-25, Math.min(25, grade)) * 10) / 10;
      });
    }
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

/**
 * Generate intervals for a given activity.
 * Creates WORK/RECOVERY intervals based on activity type and distance.
 */
export function getActivityIntervals(id: string): IntervalsDTO {
  const activity = getActivity(id);
  if (!activity) return { icu_intervals: [], icu_groups: [] };

  const random = createActivitySeededRandom(id + '-intervals');
  const isRide = activity.type === 'Ride' || activity.type === 'VirtualRide';
  const isRun = activity.type === 'Run';

  // Only generate intervals for cycling and running
  if (!isRide && !isRun) return { icu_intervals: [], icu_groups: [] };

  const intervals: ActivityInterval[] = [];
  const splitDist = isRide ? 5000 : 1000; // 5km splits for rides, 1km for runs
  const totalDist = activity.distance;
  const numSplits = Math.max(2, Math.min(12, Math.floor(totalDist / splitDist)));
  const avgSpeed = activity.average_speed || 5;
  let currentIndex = 0;

  for (let i = 0; i < numSplits; i++) {
    const isWork = i % 2 === 0;
    const segDist = splitDist * (0.9 + random() * 0.2);
    const segTime = Math.round(segDist / avgSpeed);
    const endIndex = currentIndex + Math.round(segTime / 5); // ~5 sec per sample

    const interval: ActivityInterval = {
      id: i + 1,
      type: isWork ? 'WORK' : 'RECOVERY',
      label: isWork ? `Interval ${Math.ceil((i + 1) / 2)}` : null,
      start_index: currentIndex,
      end_index: endIndex,
      distance: Math.round(segDist),
      moving_time: segTime,
      elapsed_time: Math.round(segTime * 1.02),
      average_speed: avgSpeed * (isWork ? 1.05 + random() * 0.1 : 0.85 + random() * 0.1),
      average_heartrate: activity.average_heartrate
        ? Math.round(
            activity.average_heartrate * (isWork ? 1.05 + random() * 0.05 : 0.88 + random() * 0.05)
          )
        : undefined,
      average_watts:
        isRide && activity.average_watts
          ? Math.round(
              activity.average_watts * (isWork ? 1.1 + random() * 0.1 : 0.7 + random() * 0.1)
            )
          : undefined,
      weighted_average_watts:
        isRide && activity.weighted_average_watts
          ? Math.round(
              activity.weighted_average_watts *
                (isWork ? 1.08 + random() * 0.08 : 0.72 + random() * 0.08)
            )
          : undefined,
      average_cadence: activity.average_cadence
        ? Math.round(activity.average_cadence + (random() - 0.5) * 6)
        : undefined,
      max_heartrate: activity.average_heartrate
        ? Math.round(activity.average_heartrate * (isWork ? 1.15 : 1.0))
        : undefined,
      max_watts:
        isRide && activity.average_watts
          ? Math.round(activity.average_watts * (isWork ? 1.4 : 1.0))
          : undefined,
      total_elevation_gain: Math.round(
        (activity.total_elevation_gain / numSplits) * (0.8 + random() * 0.4)
      ),
    };

    intervals.push(interval);
    currentIndex = endIndex;
  }

  // Build a summary group
  const workIntervals = intervals.filter((i) => i.type === 'WORK');
  const group: ActivityIntervalGroup = {
    id: 'work',
    count: workIntervals.length,
    distance: workIntervals.reduce((s, i) => s + i.distance, 0),
    moving_time: workIntervals.reduce((s, i) => s + i.moving_time, 0),
    elapsed_time: workIntervals.reduce((s, i) => s + i.elapsed_time, 0),
    average_speed: workIntervals.reduce((s, i) => s + i.average_speed, 0) / workIntervals.length,
    average_heartrate: workIntervals[0]?.average_heartrate
      ? workIntervals.reduce((s, i) => s + (i.average_heartrate || 0), 0) / workIntervals.length
      : undefined,
    average_watts: workIntervals[0]?.average_watts
      ? workIntervals.reduce((s, i) => s + (i.average_watts || 0), 0) / workIntervals.length
      : undefined,
    average_cadence: workIntervals[0]?.average_cadence
      ? workIntervals.reduce((s, i) => s + (i.average_cadence || 0), 0) / workIntervals.length
      : undefined,
    max_heartrate: workIntervals[0]?.max_heartrate
      ? Math.max(...workIntervals.map((i) => i.max_heartrate || 0))
      : undefined,
    max_watts: workIntervals[0]?.max_watts
      ? Math.max(...workIntervals.map((i) => i.max_watts || 0))
      : undefined,
    total_elevation_gain: workIntervals.reduce((s, i) => s + (i.total_elevation_gain || 0), 0),
  };

  return { icu_intervals: intervals, icu_groups: [group] };
}
