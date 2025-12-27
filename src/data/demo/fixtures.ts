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

import { demoRoutes, getRouteBounds, getRouteCoordinates } from './routes';

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
 * Generate a year of activities in API format
 */
function generateActivities(): ApiActivity[] {
  const activities: ApiActivity[] = [];
  const now = new Date();

  const templates = [
    { type: 'Ride', name: 'Morning Ride', dist: 45000, time: 5400, elev: 450, speed: 30, hr: 145, watts: 180, tss: 65, route: 'route-coastal-loop' },
    { type: 'Ride', name: 'Endurance Ride', dist: 80000, time: 10800, elev: 800, speed: 27, hr: 135, watts: 165, tss: 120, route: 'route-endurance' },
    { type: 'Ride', name: 'Hill Repeats', dist: 35000, time: 4500, elev: 650, speed: 28, hr: 155, watts: 210, tss: 80, route: 'route-hill-climb' },
    { type: 'Run', name: 'Easy Run', dist: 8000, time: 2700, elev: 50, speed: 10.7, hr: 140, watts: 0, tss: 35, route: 'route-riverside' },
    { type: 'Run', name: 'Long Run', dist: 15000, time: 4800, elev: 120, speed: 11.2, hr: 145, watts: 0, tss: 70, route: 'route-trail' },
    { type: 'VirtualRide', name: 'Zwift Session', dist: 30000, time: 3600, elev: 350, speed: 30, hr: 150, watts: 195, tss: 55, route: null },
    { type: 'Swim', name: 'Pool Swim', dist: 2500, time: 3000, elev: 0, speed: 3, hr: 130, watts: 0, tss: 40, route: null },
  ];

  // Track CTL/ATL for realistic values
  let ctl = 35;
  let atl = 35;
  let activityId = 1000;

  for (let daysAgo = 365; daysAgo >= 0; daysAgo--) {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(7 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 60), 0, 0);

    // Seasonal variation
    const month = date.getMonth();
    const seasonMult = month >= 11 || month <= 1 ? 0.7 :
                       month >= 2 && month <= 4 ? 0.9 :
                       month >= 5 && month <= 7 ? 1.15 : 1.0;

    const dayOfWeek = date.getDay();

    // Rest days
    const isRest = (dayOfWeek === 1 && Math.random() < 0.8) ||
                   (dayOfWeek === 4 && Math.random() < 0.5);
    if (isRest) {
      // Update CTL/ATL even on rest days
      atl = atl + (0 - atl) / 7;
      ctl = ctl + (0 - ctl) / 42;
      continue;
    }

    // Select template based on day
    let template;
    if (dayOfWeek === 0) {
      template = Math.random() > 0.3 ? templates[1] : templates[4];
    } else if (dayOfWeek === 6) {
      template = templates[Math.floor(Math.random() * 3)];
    } else if (dayOfWeek === 2 || dayOfWeek === 5) {
      const r = Math.random();
      template = r < 0.4 ? templates[3] : r < 0.7 ? templates[6] : templates[5];
    } else {
      template = templates[Math.floor(Math.random() * templates.length)];
    }

    const variance = (0.85 + Math.random() * 0.3) * seasonMult;
    const tss = Math.round(template.tss * variance);

    // Update CTL/ATL
    atl = atl + (tss - atl) / 7;
    ctl = ctl + (tss - ctl) / 42;

    activities.push({
      id: `demo-${activityId++}`,
      start_date_local: date.toISOString(),
      type: template.type,
      name: template.name,
      description: null,
      distance: Math.round(template.dist * variance),
      moving_time: Math.round(template.time * variance),
      elapsed_time: Math.round(template.time * variance * 1.05),
      total_elevation_gain: Math.round(template.elev * variance),
      total_elevation_loss: Math.round(template.elev * variance * 0.95),
      average_speed: template.speed * variance,
      max_speed: template.speed * variance * 1.3,
      average_heartrate: Math.round(template.hr * (0.95 + Math.random() * 0.1)),
      max_heartrate: Math.round(template.hr * 1.2),
      average_cadence: template.type === 'Run' ? 85 + Math.random() * 10 :
                       template.type === 'Ride' ? 85 + Math.random() * 15 : null,
      average_temp: 18 + Math.random() * 10,
      calories: Math.round(tss * 8),
      device_name: 'Demo Device',
      trainer: template.type === 'VirtualRide',
      commute: false,
      icu_training_load: tss,
      icu_intensity: template.watts ? Math.round(template.watts / 250 * 100) : null,
      icu_ftp: 250,
      icu_atl: Math.round(atl * 10) / 10,
      icu_ctl: Math.round(ctl * 10) / 10,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      stream_types: template.type === 'Swim'
        ? ['time', 'heartrate', 'distance']
        : ['time', 'latlng', 'heartrate', 'altitude', 'cadence', 'velocity_smooth'],
      locality: 'Coastal City',
      country: 'AU',
      // Store route ID for map lookups (not part of real API)
      _routeId: template.route,
    } as ApiActivity & { _routeId: string | null });
  }

  return activities;
}

/**
 * Generate a year of wellness data in API format
 */
function generateWellness(): ApiWellness[] {
  const wellness: ApiWellness[] = [];
  const now = new Date();

  let ctl = 35;
  let atl = 35;
  const baseWeight = 75;
  const baseRhr = 55;
  const baseHrv = 50;

  for (let daysAgo = 365; daysAgo >= 0; daysAgo--) {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    const dateStr = date.toISOString().split('T')[0];

    // Seasonal target CTL
    const month = date.getMonth();
    const targetCtl = month >= 11 || month <= 1 ? 35 :
                      month >= 2 && month <= 4 ? 45 :
                      month >= 5 && month <= 7 ? 55 : 45;

    // Simulate daily load
    const dayOfWeek = date.getDay();
    const isRest = dayOfWeek === 1 || (dayOfWeek === 4 && Math.random() < 0.5);
    const dailyTss = isRest ? 0 :
                     dayOfWeek === 0 || dayOfWeek === 6 ? 80 + Math.random() * 50 :
                     40 + Math.random() * 40;

    // Update CTL/ATL
    atl = atl + (dailyTss - atl) / 7;
    ctl = ctl + (dailyTss - ctl) / 42;
    ctl += (targetCtl - ctl) * 0.01;

    // Derived metrics
    const fatigueFactor = atl / 50;
    const rhr = Math.round(baseRhr + fatigueFactor * 5 + (Math.random() - 0.5) * 4);
    const hrv = Math.round(baseHrv - fatigueFactor * 5 + (Math.random() - 0.5) * 10);
    const sleepHours = 7 + (isRest ? 0.5 : 0) + (Math.random() - 0.5) * 1.5;
    const sleepScore = Math.round(70 + (sleepHours - 6) * 10 + Math.random() * 10);

    wellness.push({
      id: dateStr,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      rampRate: Math.round((ctl - (wellness[wellness.length - 1]?.ctl || ctl)) * 100) / 100,
      ctlLoad: Math.round(dailyTss),
      atlLoad: Math.round(dailyTss),
      sportInfo: [
        { type: 'Ride', eftp: 250 + Math.round((ctl - 40) * 1.5), wPrime: 15000, pMax: 800 },
        { type: 'Run', eftp: 300, wPrime: 20000, pMax: 600 },
      ],
      weight: Math.round((baseWeight + Math.sin(daysAgo * 0.1) * 1.5) * 10) / 10,
      restingHR: rhr,
      hrv: Math.max(20, Math.min(100, hrv)),
      hrvSDNN: Math.round(hrv * 1.2),
      sleepSecs: Math.round(sleepHours * 3600),
      sleepScore: Math.max(50, Math.min(100, sleepScore)),
      sleepQuality: sleepScore >= 80 ? 3 : sleepScore >= 60 ? 2 : 1,
      steps: Math.round((isRest ? 5000 : 10000) + Math.random() * 5000),
      vo2max: 50 + (ctl - 40) * 0.1,
    });
  }

  return wellness;
}

// ============================================================================
// FIXTURE DATA (generated once on module load)
// ============================================================================

export const fixtures = {
  athlete: DEMO_ATHLETE,
  activities: generateActivities(),
  wellness: generateWellness(),
};

// ============================================================================
// FIXTURE ACCESS FUNCTIONS
// ============================================================================

export function getActivity(id: string): ApiActivity | undefined {
  return fixtures.activities.find(a => a.id === id);
}

export function getActivities(params?: {
  oldest?: string;
  newest?: string;
}): ApiActivity[] {
  let result = [...fixtures.activities];

  if (params?.oldest) {
    const oldest = new Date(params.oldest);
    result = result.filter(a => new Date(a.start_date_local) >= oldest);
  }
  if (params?.newest) {
    const newest = new Date(params.newest);
    result = result.filter(a => new Date(a.start_date_local) <= newest);
  }

  return result.reverse(); // Newest first
}

export function getActivityMap(id: string, boundsOnly = false): ApiActivityMap | null {
  const activity = getActivity(id) as ApiActivity & { _routeId?: string };
  if (!activity) return null;

  // Virtual rides and swims don't have maps
  if (activity.type === 'VirtualRide' || activity.type === 'Swim') {
    return null;
  }

  // Get route coordinates
  const routeId = activity._routeId;
  const route = routeId ? demoRoutes.find(r => r.id === routeId) : null;

  if (route) {
    const coords = getRouteCoordinates(routeId, true);
    const bounds = getRouteBounds(coords);
    return {
      bounds,
      latlngs: boundsOnly ? null : coords,
      route: null,
      weather: null,
    };
  }

  // Fallback: generate simple route around demo location
  const coords: [number, number][] = [];
  const baseLat = -33.89;
  const baseLng = 151.20;
  const points = 50;
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    coords.push([
      baseLat + Math.sin(angle) * 0.01 + (Math.random() - 0.5) * 0.001,
      baseLng + Math.cos(angle) * 0.01 + (Math.random() - 0.5) * 0.001,
    ]);
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

  const duration = activity.moving_time;
  const points = Math.min(duration, 1000); // Max 1000 points
  const interval = Math.ceil(duration / points);

  const streams: ApiActivityStreams = {
    time: Array.from({ length: points }, (_, i) => i * interval),
  };

  // Heart rate stream
  if (activity.average_heartrate) {
    const baseHr = activity.average_heartrate;
    streams.heartrate = streams.time.map((t) => {
      const progress = t / duration;
      const warmup = Math.min(1, progress * 5); // Warmup effect
      const fatigue = progress * 5; // Cardiac drift
      return Math.round(baseHr * 0.85 * warmup + fatigue + (Math.random() - 0.5) * 10);
    });
  }

  // Power stream (for rides)
  if (activity.type === 'Ride' || activity.type === 'VirtualRide') {
    const ftp = 250;
    streams.watts = streams.time.map(() => {
      return Math.round(ftp * 0.7 + Math.random() * ftp * 0.4);
    });
  }

  // GPS stream
  if (activity.stream_types.includes('latlng')) {
    const map = getActivityMap(id, false);
    if (map?.latlngs) {
      // Interpolate to match time points
      const coords = map.latlngs;
      streams.latlng = streams.time.map((_, i) => {
        const idx = Math.floor((i / points) * (coords.length - 1));
        return coords[idx];
      });
    }
  }

  // Altitude stream
  if (activity.stream_types.includes('altitude')) {
    const maxElev = activity.total_elevation_gain;
    streams.altitude = streams.time.map((t) => {
      const progress = t / duration;
      return Math.round(50 + Math.sin(progress * Math.PI * 2) * maxElev / 2);
    });
  }

  // Cadence stream
  if (activity.average_cadence) {
    streams.cadence = streams.time.map(() => {
      return Math.round(activity.average_cadence! + (Math.random() - 0.5) * 10);
    });
  }

  return streams;
}

export function getWellness(params?: {
  oldest?: string;
  newest?: string;
}): ApiWellness[] {
  let result = [...fixtures.wellness];

  if (params?.oldest) {
    result = result.filter(w => w.id >= params.oldest!);
  }
  if (params?.newest) {
    result = result.filter(w => w.id <= params.newest!);
  }

  return result;
}
