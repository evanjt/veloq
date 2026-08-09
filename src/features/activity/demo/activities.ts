import { getRouteLocation } from '@/features/routes/demo/routes';
import {
  getDemoReferenceDate,
  formatDateId,
  formatLocalISOString,
  generateActivityId,
  createDateSeededRandom,
  createActivitySeededRandom,
  getTimeOfDay,
} from '@/data/demo/random';
import { getTrainingDay } from '@/features/fitness/demo/periodization';

import type { ApiActivity, ApiWellness, ApiAthlete } from './types';
import { generateSkylineBytes } from './skyline';
import { generateStableTestActivities } from './stableActivities';

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

type SessionType = 'endurance' | 'tempo' | 'interval' | 'long' | 'recovery' | 'race';

const ZONE_DISTRIBUTIONS: Record<SessionType, number[]> = {
  endurance: [0.08, 0.62, 0.2, 0.07, 0.02, 0.01, 0.0],
  tempo: [0.05, 0.2, 0.38, 0.28, 0.06, 0.02, 0.01],
  interval: [0.12, 0.22, 0.12, 0.14, 0.28, 0.09, 0.03],
  long: [0.1, 0.55, 0.22, 0.08, 0.03, 0.015, 0.005],
  recovery: [0.35, 0.5, 0.12, 0.03, 0.0, 0.0, 0.0],
  race: [0.04, 0.12, 0.2, 0.28, 0.25, 0.08, 0.03],
};

const RIDE_NAMES: Record<SessionType, string[]> = {
  endurance: ['Steady Ride', 'Zone 2 Cruise', 'Coffee Ride', 'Easy Spin'],
  tempo: ['Sweet Spot Intervals', 'Tempo Ride', 'Threshold Efforts', 'FTP Builder'],
  interval: ['VO2max 5x3min', 'High Intensity Ride', 'Power Intervals', 'Anaerobic Repeats'],
  long: ['Endurance Ride', 'Gran Fondo Prep', 'Long Ride', 'Century Prep'],
  recovery: ['Recovery Spin', 'Easy Spin', 'Active Recovery'],
  race: ['Race Simulation', 'Time Trial', 'Race Day'],
};

const RUN_NAMES: Record<SessionType, string[]> = {
  endurance: ['Easy Run', 'Zone 2 Run', 'Aerobic Run', 'Base Run'],
  tempo: ['Tempo Run', 'Threshold Run', 'Steady State Run', 'Cruise Intervals'],
  interval: ['Track Repeats', 'VO2max Intervals', 'Speed Work', 'Hill Repeats'],
  long: ['Long Run', 'Trail Long Run', 'Progressive Long Run'],
  recovery: ['Recovery Jog', 'Shake-Out Run', 'Easy Jog'],
  race: ['Race Pace Run', 'Race Simulation', 'Parkrun'],
};

function pickFromArray<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function generateActivityName(
  type: string,
  hour: number,
  session: SessionType,
  routeId?: string | null
): string {
  const timeOfDay = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const hash = (routeId || type).length;
  const nameIndex = hash % 4;

  switch (type) {
    case 'Ride':
      return `${timeOfDay} ${(RIDE_NAMES[session] || RIDE_NAMES.endurance)[nameIndex % (RIDE_NAMES[session] || RIDE_NAMES.endurance).length]}`;
    case 'Run':
      return `${timeOfDay} ${(RUN_NAMES[session] || RUN_NAMES.endurance)[nameIndex % (RUN_NAMES[session] || RUN_NAMES.endurance).length]}`;
    case 'VirtualRide':
      if (routeId?.includes('grindelwald')) return `${timeOfDay} Virtual Ride - Swiss Alps`;
      if (routeId?.includes('lavaux')) return `${timeOfDay} Virtual Ride - Vineyards`;
      if (routeId?.includes('vuelta')) return `${timeOfDay} Virtual Ride - Stage Climb`;
      if (routeId?.includes('rio')) return `${timeOfDay} Virtual Ride - Coastal`;
      return `${timeOfDay} Virtual Ride`;
    case 'Swim':
      return routeId ? `${timeOfDay} Open Water Swim` : `${timeOfDay} Pool Swim`;
    case 'Hike':
      return session === 'long' ? `${timeOfDay} Mountain Hike` : `${timeOfDay} Valley Hike`;
    case 'Walk':
      return `${timeOfDay} Walk`;
    default:
      return `${timeOfDay} ${type}`;
  }
}

function generateActivities(): ApiActivity[] {
  const activities: ApiActivity[] = [];
  const referenceDate = getDemoReferenceDate();
  let globalActivityIndex = 0;

  interface RouteTemplate {
    type: string;
    dist: number;
    time: number;
    elev: number;
    speed: number;
    hr: number;
    watts: number;
    tss: number;
    route: string | null;
    sessions: SessionType[];
  }

  const templates: RouteTemplate[] = [
    {
      type: 'Ride',
      dist: 30000,
      time: 4500,
      elev: 150,
      speed: 6.67,
      hr: 145,
      watts: 180,
      tss: 65,
      route: 'route-valais-ride-2',
      sessions: ['endurance', 'tempo', 'interval'],
    },
    {
      type: 'Ride',
      dist: 75000,
      time: 10800,
      elev: 200,
      speed: 6.94,
      hr: 135,
      watts: 165,
      tss: 120,
      route: 'route-valais-ride-1',
      sessions: ['long', 'endurance'],
    },
    {
      type: 'VirtualRide',
      dist: 23000,
      time: 3600,
      elev: 270,
      speed: 6.39,
      hr: 150,
      watts: 195,
      tss: 55,
      route: 'route-rouvy-grindelwald',
      sessions: ['endurance', 'tempo', 'interval'],
    },
    {
      type: 'VirtualRide',
      dist: 17000,
      time: 2700,
      elev: 280,
      speed: 6.11,
      hr: 155,
      watts: 210,
      tss: 50,
      route: 'route-rouvy-lavaux',
      sessions: ['tempo', 'interval'],
    },
    {
      type: 'VirtualRide',
      dist: 21000,
      time: 3300,
      elev: 370,
      speed: 6.39,
      hr: 148,
      watts: 190,
      tss: 60,
      route: 'route-rouvy-vuelta',
      sessions: ['endurance', 'tempo'],
    },
    {
      type: 'Run',
      dist: 3000,
      time: 1200,
      elev: 20,
      speed: 2.5,
      hr: 140,
      watts: 0,
      tss: 25,
      route: 'route-rio-run-1',
      sessions: ['endurance', 'recovery'],
    },
    {
      type: 'Run',
      dist: 15000,
      time: 4800,
      elev: 50,
      speed: 3.11,
      hr: 145,
      watts: 0,
      tss: 70,
      route: 'route-rio-run-2',
      sessions: ['long', 'endurance'],
    },
    {
      type: 'Run',
      dist: 3000,
      time: 1100,
      elev: 15,
      speed: 2.72,
      hr: 155,
      watts: 0,
      tss: 30,
      route: 'route-rio-run-3',
      sessions: ['tempo', 'interval'],
    },
    {
      type: 'Swim',
      dist: 2500,
      time: 3000,
      elev: 0,
      speed: 0.83,
      hr: 130,
      watts: 0,
      tss: 40,
      route: null,
      sessions: ['endurance'],
    },
    {
      type: 'Swim',
      dist: 500,
      time: 1200,
      elev: 0,
      speed: 0.42,
      hr: 135,
      watts: 0,
      tss: 25,
      route: 'route-la-orotava-swim-1',
      sessions: ['endurance'],
    },
    {
      type: 'Swim',
      dist: 400,
      time: 900,
      elev: 0,
      speed: 0.44,
      hr: 140,
      watts: 0,
      tss: 20,
      route: 'route-la-orotava-swim-3',
      sessions: ['tempo'],
    },
    {
      type: 'Hike',
      dist: 10000,
      time: 14400,
      elev: 1000,
      speed: 0.69,
      hr: 115,
      watts: 0,
      tss: 80,
      route: 'route-lauterbrunnen-hike-3',
      sessions: ['long'],
    },
    {
      type: 'Hike',
      dist: 1200,
      time: 2400,
      elev: 60,
      speed: 0.5,
      hr: 105,
      watts: 0,
      tss: 20,
      route: 'route-lauterbrunnen-hike-2',
      sessions: ['endurance'],
    },
    {
      type: 'Walk',
      dist: 3000,
      time: 2400,
      elev: 700,
      speed: 1.25,
      hr: 95,
      watts: 0,
      tss: 15,
      route: 'route-cape-town-walk-3',
      sessions: ['endurance'],
    },
    {
      type: 'Walk',
      dist: 2300,
      time: 1800,
      elev: 140,
      speed: 1.28,
      hr: 90,
      watts: 0,
      tss: 12,
      route: 'route-cape-town-walk-5',
      sessions: ['recovery'],
    },
  ];

  const homeRoutes: Record<string, number[]> = {
    Ride: [0],
    VirtualRide: [2],
    Run: [5],
  };

  let ctl = 30;
  let atl = 30;
  let lastRoute: string | null = null;

  const swissIndices = [0, 1, 2, 3, 11, 12];

  function selectTemplate(
    indices: number[],
    rng: () => number,
    session: SessionType
  ): RouteTemplate {
    const withSession = indices.filter((i) => templates[i].sessions.includes(session));
    const pool = withSession.length > 0 ? withSession : indices;
    const noRepeat = pool.filter((i) => templates[i].route !== lastRoute);
    const final = noRepeat.length > 0 ? noRepeat : pool;
    return templates[final[Math.floor(rng() * final.length)]];
  }

  function getStreamTypes(type: string, route: string | null): string[] {
    if (type === 'Swim' && !route) return ['time', 'heartrate', 'distance'];
    if (type === 'Swim') return ['time', 'latlng', 'heartrate', 'distance'];
    if (type === 'Hike' || type === 'Walk')
      return ['time', 'latlng', 'heartrate', 'altitude', 'grade_smooth'];
    if (type === 'VirtualRide' && !route)
      return [
        'time',
        'heartrate',
        'altitude',
        'cadence',
        'watts',
        'velocity_smooth',
        'grade_smooth',
      ];
    if (type === 'Run')
      return [
        'time',
        'latlng',
        'heartrate',
        'altitude',
        'cadence',
        'velocity_smooth',
        'grade_smooth',
      ];
    return [
      'time',
      'latlng',
      'heartrate',
      'altitude',
      'cadence',
      'watts',
      'velocity_smooth',
      'grade_smooth',
    ];
  }

  function pushActivity(
    id: string,
    date: Date,
    template: RouteTemplate,
    session: SessionType,
    ctx: ReturnType<typeof getTrainingDay>,
    rng: () => number
  ) {
    const fitnessRatio = ctx.ftpWatts / 250;
    const tsbEffect = ctl - atl > 10 ? 1.03 : atl - ctl > 10 ? 0.96 : 1.0;
    const perf = fitnessRatio * ctx.formFactor * tsbEffect * (0.97 + rng() * 0.06);

    const sessionVolume: Record<SessionType, number> = {
      endurance: 1.0,
      tempo: 0.85,
      interval: 0.7,
      long: 1.4,
      recovery: 0.55,
      race: 0.9,
    };
    const vol = ctx.volumeMultiplier * (sessionVolume[session] || 1.0);

    const movingTime = Math.round(template.time * vol);
    const distance = Math.round(template.dist * vol * perf);

    const sessionIntensity: Record<SessionType, number> = {
      endurance: 0.68,
      tempo: 0.88,
      interval: 0.95,
      long: 0.65,
      recovery: 0.52,
      race: 1.05,
    };
    const intensity = sessionIntensity[session] || 0.7;

    const avgWatts = template.watts
      ? Math.round(ctx.ftpWatts * intensity * ctx.formFactor * (0.96 + rng() * 0.08))
      : null;
    const tss = template.watts
      ? Math.round((movingTime / 3600) * Math.pow(intensity * ctx.formFactor, 2) * 100)
      : Math.round(template.tss * vol * ctx.formFactor);

    atl = atl + (tss - atl) / 7;
    ctl = ctl + (tss - ctl) / 42;

    const baseHr =
      template.hr * (session === 'recovery' ? 0.85 : session === 'interval' ? 1.08 : 1.0);
    const hrFitnessDrift = 1 - (fitnessRatio - 1) * 0.5;
    const avgHr = Math.round(baseHr * hrFitnessDrift * ctx.formFactor * (0.96 + rng() * 0.08));

    const location = template.route
      ? getRouteLocation(template.route)
      : { locality: null, country: null };

    const zoneDist = ZONE_DISTRIBUTIONS[session] || ZONE_DISTRIBUTIONS.endurance;
    const zoneTimes = template.watts
      ? zoneDist.map((pct, i) => ({ id: `Z${i + 1}`, secs: Math.round(movingTime * pct) }))
      : null;

    const hrZoneSecs = !template.watts
      ? [0.12, 0.35, 0.3, 0.17, 0.06].map((p) => Math.round(movingTime * p))
      : null;

    const a: ApiActivity & { _routeId: string | null } = {
      id,
      start_date_local: formatLocalISOString(date),
      type: template.type,
      name: generateActivityName(template.type, date.getHours(), session, template.route),
      description: null,
      distance,
      moving_time: movingTime,
      elapsed_time: Math.round(movingTime * (1.03 + rng() * 0.04)),
      total_elevation_gain: Math.round(template.elev * vol),
      total_elevation_loss: Math.round(template.elev * vol * 0.95),
      average_speed: distance / movingTime,
      max_speed: (distance / movingTime) * (1.2 + rng() * 0.2),
      average_heartrate: Math.max(80, Math.min(195, avgHr)),
      max_heartrate: Math.round(Math.min(200, avgHr * (1.12 + rng() * 0.08))),
      average_cadence:
        template.type === 'Run'
          ? 168 + Math.round(rng() * 12)
          : template.type === 'Ride' || template.type === 'VirtualRide'
            ? 82 + Math.round(rng() * 16)
            : null,
      average_temp: 14 + Math.round(rng() * 14),
      calories: Math.round(tss * (7 + rng() * 2)),
      device_name: 'Demo Device',
      trainer: template.type === 'VirtualRide',
      commute: false,
      average_watts: avgWatts,
      weighted_average_watts: avgWatts ? Math.round(avgWatts * (1.03 + rng() * 0.06)) : null,
      icu_training_load: tss,
      icu_intensity: avgWatts ? Math.round((avgWatts / ctx.ftpWatts) * 100) : null,
      icu_ftp: ctx.ftpWatts,
      icu_atl: Math.round(atl * 10) / 10,
      icu_ctl: Math.round(ctl * 10) / 10,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones:
        Math.round(ctx.ftpWatts * 0.55) > 0
          ? [
              Math.round(ctx.ftpWatts * 0.55),
              Math.round(ctx.ftpWatts * 0.75),
              Math.round(ctx.ftpWatts * 0.9),
              ctx.ftpWatts,
              Math.round(ctx.ftpWatts * 1.18),
              Math.round(ctx.ftpWatts * 1.5),
            ]
          : [125, 170, 210, 250, 290, 350],
      icu_zone_times: zoneTimes,
      stream_types: getStreamTypes(template.type, template.route),
      locality: location.locality,
      country: location.country,
      _routeId: template.route,
    };
    a.skyline_chart_bytes = generateSkylineBytes(
      zoneTimes,
      hrZoneSecs,
      createActivitySeededRandom(id)
    );
    activities.push(a);
    lastRoute = template.route;
  }

  for (let daysAgo = 365; daysAgo >= 0; daysAgo--) {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() - daysAgo);
    const dateStr = formatDateId(date);
    const dayRandom = createDateSeededRandom(dateStr + '-activity');
    const dayOfWeek = date.getDay();

    const ctx = getTrainingDay(daysAgo, dateStr);

    if (ctx.isLifeGap || ctx.isIllness) {
      if (dayRandom() < ctx.restDayProbability) {
        atl = atl + (0 - atl) / 7;
        ctl = ctl + (0 - ctl) / 42;
        continue;
      }
    }

    const spontaneousRest = dayRandom() < ctx.restDayProbability;
    if (spontaneousRest) {
      atl = atl + (0 - atl) / 7;
      ctl = ctl + (0 - ctl) / 42;
      continue;
    }

    const isHard = dayRandom() < ctx.hardSessionProbability;
    const session: SessionType = ctx.isIllness
      ? 'recovery'
      : isHard
        ? dayRandom() < 0.5
          ? 'interval'
          : 'tempo'
        : dayOfWeek === 0
          ? 'long'
          : ctx.phase === 'race' && dayRandom() < 0.3
            ? 'race'
            : ctx.phase === 'activeRecovery' || ctx.phase === 'taper'
              ? dayRandom() < 0.4
                ? 'recovery'
                : 'endurance'
              : 'endurance';

    const timeOfDay = getTimeOfDay(dateStr);
    date.setHours(timeOfDay.hours, timeOfDay.minutes, 0, 0);

    let template;
    if (daysAgo <= 7) {
      template = selectTemplate(swissIndices, dayRandom, session);
    } else if (dayOfWeek === 0) {
      const r = dayRandom();
      if (r < 0.4) template = selectTemplate([1], dayRandom, 'long');
      else if (r < 0.7) template = selectTemplate([6], dayRandom, 'long');
      else template = selectTemplate([11], dayRandom, 'long');
    } else if (dayOfWeek === 6) {
      const r = dayRandom();
      if (r < 0.35) template = selectTemplate([0, 1], dayRandom, session);
      else if (r < 0.6) template = selectTemplate([5, 6, 7], dayRandom, session);
      else if (r < 0.8) template = selectTemplate([11, 12], dayRandom, session);
      else template = selectTemplate([13, 14], dayRandom, session);
    } else if (dayOfWeek === 2 || dayOfWeek === 5) {
      const r = dayRandom();
      if (r < 0.35) template = selectTemplate([5, 6, 7], dayRandom, session);
      else if (r < 0.55) template = selectTemplate([8, 9, 10], dayRandom, session);
      else template = selectTemplate([2, 3, 4], dayRandom, session);
    } else {
      const sportType = dayRandom() < 0.4 ? 'Ride' : dayRandom() < 0.7 ? 'Run' : null;
      if (sportType && homeRoutes[sportType] && dayRandom() < 0.4) {
        template = selectTemplate(homeRoutes[sportType], dayRandom, session);
      } else {
        template = selectTemplate([...Array(templates.length).keys()], dayRandom, session);
      }
    }

    const activityId = generateActivityId(dateStr, globalActivityIndex);
    globalActivityIndex++;
    pushActivity(activityId, date, template, session, ctx, dayRandom);

    if (dayRandom() < ctx.doubleDayProbability) {
      const pmDate = new Date(date);
      pmDate.setHours(17 + Math.floor(dayRandom() * 2), Math.floor(dayRandom() * 60), 0, 0);
      const pmSession: SessionType =
        session === 'interval' || session === 'tempo' ? 'recovery' : 'endurance';
      const pmSport = template.type === 'Ride' ? [5, 6, 7] : [0, 2, 3, 4];
      const pmTemplate = selectTemplate(pmSport, dayRandom, pmSession);
      const pmId = generateActivityId(dateStr, globalActivityIndex);
      globalActivityIndex++;
      pushActivity(pmId, pmDate, pmTemplate, pmSession, ctx, dayRandom);
    }
  }

  // === STRESS TEST: 20 runs on the same route with fitness-driven times ===
  // Pre-compute all times, then ensure demo-stress-0 (newest) is the fastest
  const stressTemplate = templates[5]; // route-rio-run-1
  const stressLocation = getRouteLocation(stressTemplate.route!);
  const stressTimes: number[] = [];
  const stressDaysAgo: number[] = [];
  for (let i = 0; i < 20; i++) {
    const da = 14 + Math.floor((i / 20) * 351);
    stressDaysAgo.push(da);
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - da);
    const ds = formatDateId(d);
    const c = getTrainingDay(da, ds);
    const ratio = c.ftpWatts / 250;
    stressTimes.push(Math.round(stressTemplate.time / (ratio * Math.min(c.formFactor, 1.05))));
  }
  const minTime = Math.min(...stressTimes);
  stressTimes[0] = Math.max(minTime - 5, Math.round(stressTemplate.time * 0.82));

  for (let i = 0; i < 20; i++) {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() - stressDaysAgo[i]);
    date.setHours(6, 30, 0, 0);
    const dateStr = formatDateId(date);
    const ctx = getTrainingDay(stressDaysAgo[i], dateStr);
    const movingTime = i === 0 ? stressTimes[0] : Math.max(stressTimes[0] + 1, stressTimes[i]);
    const fitnessRatio = ctx.ftpWatts / 250;

    activities.push({
      id: `demo-stress-${i}`,
      start_date_local: formatLocalISOString(date),
      type: stressTemplate.type,
      name: `Morning Run`,
      description: null,
      distance: stressTemplate.dist,
      moving_time: movingTime,
      elapsed_time: Math.round(movingTime * 1.05),
      total_elevation_gain: stressTemplate.elev,
      total_elevation_loss: Math.round(stressTemplate.elev * 0.95),
      average_speed: stressTemplate.dist / movingTime,
      max_speed: (stressTemplate.dist / movingTime) * 1.3,
      average_heartrate: Math.round(stressTemplate.hr * (1.05 - fitnessRatio * 0.05) + (i % 8) - 4),
      max_heartrate: Math.round(stressTemplate.hr * 1.2),
      average_cadence: 170 + (i % 10),
      average_temp: 22,
      calories: stressTemplate.tss * 8,
      device_name: 'Demo Device',
      trainer: false,
      commute: true,
      average_watts: null,
      weighted_average_watts: null,
      icu_training_load: stressTemplate.tss,
      icu_intensity: null,
      icu_ftp: ctx.ftpWatts,
      icu_atl: Math.round(atl * 10) / 10,
      icu_ctl: Math.round(ctl * 10) / 10,
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
      _routeId: stressTemplate.route,
    } as ApiActivity & { _routeId: string | null });
  }

  return activities;
}

function generateWellness(): ApiWellness[] {
  const wellness: ApiWellness[] = [];
  const referenceDate = getDemoReferenceDate();

  let ctl = 30;
  let atl = 30;

  for (let daysAgo = 365; daysAgo >= 0; daysAgo--) {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() - daysAgo);
    const dateStr = formatDateId(date);
    const rng = createDateSeededRandom(dateStr + '-wellness-fixture');
    const ctx = getTrainingDay(daysAgo, dateStr);

    const isRest = rng() < ctx.restDayProbability;
    const dailyTss = isRest
      ? 0
      : Math.round(
          ctx.targetCTL * ctx.volumeMultiplier * ctx.intensityMultiplier * (0.8 + rng() * 0.4)
        );

    atl = atl + (dailyTss - atl) / 7;
    ctl = ctl + (dailyTss - ctl) / 42;

    const fitnessBonus = Math.max(0, (ctx.ftpWatts - 235) / 30) * 4;
    const acuteLoadStress = (atl / 50) * 8;
    const tsbBoost = Math.max(0, (ctl - atl) / 20) * 3;
    const illnessHit = ctx.isIllness ? 12 : 0;

    const baseHrv = 52;
    const hrv = Math.round(
      baseHrv + fitnessBonus + tsbBoost - acuteLoadStress - illnessHit + (rng() - 0.5) * 12
    );

    const baseRhr = 57;
    const rhr = Math.round(
      baseRhr -
        fitnessBonus * 0.4 +
        acuteLoadStress * 0.7 +
        (ctx.isIllness ? 7 : 0) +
        (rng() - 0.5) * 4
    );

    // Weight: 77kg start → gradual loss during training → 73.5 at peak → slight regain
    const weightProgress = (365 - daysAgo) / 365;
    const trainingWeightLoss = Math.min(3.5, weightProgress * 5);
    const peakRebound = daysAgo < 50 ? (50 - daysAgo) * 0.02 : 0;
    const offseasonGain = daysAgo > 330 ? (daysAgo - 330) * 0.015 : 0;
    const weight = 77 - trainingWeightLoss + peakRebound + offseasonGain + (rng() - 0.5) * 0.8;

    const overreaching = Math.max(0, atl - ctl - 10);
    const baseSleep = 7.5;
    const sleepHours =
      baseSleep +
      (ctx.isIllness ? 1.2 : 0) +
      (isRest ? 0.4 : 0) -
      overreaching * 0.03 +
      (rng() - 0.5) * 1.0;
    const sleepScore = Math.round(72 + (sleepHours - 6.5) * 12 + (rng() - 0.5) * 10);

    wellness.push({
      id: dateStr,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      rampRate: Math.round((ctl - (wellness[wellness.length - 1]?.ctl || ctl)) * 100) / 100,
      ctlLoad: Math.round(dailyTss),
      atlLoad: Math.round(dailyTss),
      sportInfo: [
        { type: 'Ride', eftp: ctx.ftpWatts, wPrime: 15000, pMax: Math.round(ctx.ftpWatts * 3.2) },
        { type: 'Run', eftp: Math.round(ctx.runPaceMs * 120), wPrime: 20000, pMax: 600 },
      ],
      weight: Math.round(weight * 10) / 10,
      restingHR: Math.max(42, Math.min(70, rhr)),
      hrv: Math.max(20, Math.min(100, hrv)),
      hrvSDNN: Math.round(Math.max(20, Math.min(100, hrv)) * 1.2),
      sleepSecs: Math.round(Math.max(5, Math.min(10, sleepHours)) * 3600),
      sleepScore: Math.max(40, Math.min(100, sleepScore)),
      sleepQuality: sleepScore >= 80 ? 3 : sleepScore >= 60 ? 2 : 1,
      steps: Math.round((isRest ? 4000 : 8000) + rng() * 6000),
      vo2max: 48 + fitnessBonus * 0.3,
    });
  }

  return wellness;
}

const generatedActivities = generateActivities();
const stableActivities = generateStableTestActivities();

// Stable test activities come first so e2e flows see them as the most recent.
export const fixtures = {
  athlete: DEMO_ATHLETE,
  activities: [...stableActivities, ...generatedActivities],
  wellness: generateWellness(),
};

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

  return result.sort(
    (a, b) => new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime()
  );
}
