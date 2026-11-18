/**
 * The demo library's answers for everything beyond the feed, the map and the fitness
 * screens: one activity's detail, routes and sections with their passes, strength
 * sessions, recordings and the writes. Each is drawn from the same activities as the
 * base answers, so a route's attempts are the activities that ride it.
 */

import {
  ACTIVITIES,
  baseResults,
  DAY,
  LIBRARY_END,
  LOADS,
  LOOPS,
  ROUTE_NAMES,
  ROUTE_SPORT,
  SECTION_NAMES,
  bounds,
  encodeTrack,
  heatTilePng,
  isoLocal,
  lengthOf,
  newestFirst,
  seconds,
  sectionRows,
  singles,
  streams,
  trackOf,
  type DemoActivity,
  type DemoResults,
  type Result,
} from './connectDemoBase';
import { helloOf } from './connectPhoneShim';

type Rows<T> = Record<string, T>;

const sectionPart = (index: number) => (LOOPS[index] ?? []).slice(10, 40);
const sectionLength = (index: number) => Math.round(lengthOf(sectionPart(index)));
const routeLength = (index: number) => Math.round(lengthOf(LOOPS[index] ?? []));
const onRoute = (index: number) => ACTIVITIES.filter((a) => a.route === index);
const speedOf = (a: DemoActivity) => a.distance / Math.max(1, a.seconds);

/** The seconds an activity took over the section of route `index`. */
const passTime = (a: DemoActivity, index: number) =>
  Math.max(20, Math.round(sectionLength(index) / (speedOf(a) * 1.08)));

const geoText = (features: unknown[]) => ({
  text: JSON.stringify({ type: 'FeatureCollection', features }),
  packedLine: null,
});

const lineFeature = (
  line: readonly (readonly [number, number])[],
  properties: Record<string, unknown> = {}
) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'LineString', coordinates: line.map(([la, lo]) => [lo, la]) },
});

const range = (count: number) => Array.from({ length: count }, (_, at) => at);
const done: Result<'section.rename'> = { ok: true };

// ── One activity ──

const MAX_HR = 186;

function zoneBands(a: DemoActivity) {
  const shares = [0.12, 0.46, 0.24, 0.13, 0.05];
  const edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
  return shares.map((share, at) => ({
    zone: at + 1,
    minBpm: Math.round(MAX_HR * (edges[at] as number)),
    maxBpm: Math.round(MAX_HR * (edges[at + 1] as number)),
    seconds: Math.round(a.seconds * share),
    percent: Math.round(share * 100),
    share,
  }));
}

function powerBands(a: DemoActivity) {
  const shares = [0.2, 0.38, 0.22, 0.12, 0.05, 0.02, 0.01];
  const edges = [0, 140, 190, 228, 266, 304, 380];
  return shares.map((share, at) => ({
    zone: at + 1,
    minWatts: edges[at] as number,
    maxWatts: at === shares.length - 1 ? null : (edges[at + 1] as number),
    seconds: Math.round(a.seconds * share),
    percent: Math.round(share * 100),
    share,
  }));
}

const STRENGTH = [
  { category: 0, label: 'Bench press', equipment: 'barbell', base: 62 },
  { category: 28, label: 'Back squat', equipment: 'barbell', base: 85 },
  { category: 8, label: 'Deadlift', equipment: 'barbell', base: 105 },
  { category: 23, label: 'Bent-over row', equipment: 'barbell', base: 55 },
  { category: 24, label: 'Shoulder press', equipment: 'dumbbell', base: 24 },
  { category: 21, label: 'Pull-up', equipment: 'bodyweight', base: 0 },
  { category: 7, label: 'Biceps curl', equipment: 'dumbbell', base: 14 },
  { category: 19, label: 'Plank', equipment: 'bodyweight', base: 0 },
] as const;

const MUSCLES = [
  { slug: 'chest', region: 'upper' },
  { slug: 'deltoids', region: 'upper' },
  { slug: 'biceps', region: 'upper' },
  { slug: 'upper-back', region: 'upper' },
  { slug: 'abs', region: 'core' },
  { slug: 'quadriceps', region: 'lower' },
  { slug: 'gluteal', region: 'lower' },
  { slug: 'hamstring', region: 'lower' },
];

const strengthActivities = ACTIVITIES.filter((a) => a.sport.family === 'strength');

/** The exercises a strength activity holds: four or five, chosen by its position in the year. */
function exercisesOf(a: DemoActivity) {
  const at = strengthActivities.indexOf(a);
  const count = 4 + (at % 2);
  const progress = 1 + at * 0.004;
  return range(count).map((step) => {
    const spec = STRENGTH[(at * 3 + step) % STRENGTH.length] as (typeof STRENGTH)[number];
    return { spec, weight: Math.round(spec.base * progress * 2) / 2 };
  });
}

function exerciseSets(a: DemoActivity): Result<'activity.exerciseSets'> {
  const groups: Result<'activity.exerciseSets'>['groups'] = [];
  const sets: Result<'activity.exerciseSets'>['sets'] = [];
  let order = 0;
  const exercises = a.sport.family === 'strength' ? exercisesOf(a) : [];
  for (const { spec, weight } of exercises) {
    const mine = range(3).map((n) => {
      const timed = spec.category === 19;
      return {
        activityId: a.id,
        setOrder: order++,
        exerciseCategory: spec.category,
        exerciseName: null,
        displayName: spec.label,
        setType: 1,
        repetitions: timed ? null : 10 - n,
        weightKg: timed || weight === 0 ? null : weight + n * 2.5,
        durationSecs: timed ? 45 + n * 10 : null,
        startTime: seconds(a.start) + order * 150,
      };
    });
    sets.push(...mine);
    groups.push({
      name: spec.label,
      exerciseCategory: spec.category,
      sets: mine,
      bestSet: mine[2] ?? null,
      restSeconds: [90, 90],
    });
  }
  return {
    sets,
    groups,
    activeSetCount: sets.length,
    exerciseCount: groups.length,
    totalVolumeKg: Math.round(
      sets.reduce((sum, s) => sum + (s.weightKg ?? 0) * (s.repetitions ?? 0), 0)
    ),
    totalDurationSecs: a.seconds,
  };
}

function poolSwim(a: DemoActivity): Result<'activity.detail'>['poolSwim'] {
  const lengthCount = Math.max(8, Math.round(a.distance / 25));
  const lengths = range(Math.min(lengthCount, 60)).map((index) => {
    const elapsed = 28 + (index % 5) + (index > 40 ? 2 : 0);
    const strokes = 17 + (index % 3);
    return {
      index,
      active: true,
      stroke: 2,
      strokeKey: 'freestyle',
      elapsedSecs: elapsed,
      strokes,
      speedMps: 25 / elapsed,
      swolf: elapsed + strokes,
    };
  });
  const elapsed = lengths.reduce((sum, l) => sum + (l.elapsedSecs ?? 0), 0);
  return {
    state: 'read',
    poolLengthM: 25,
    poolUnit: 'metres',
    lengths,
    strokeTotals: [
      {
        stroke: 2,
        strokeKey: 'freestyle',
        lengths: lengths.length,
        distanceM: lengths.length * 25,
        elapsedSecs: elapsed,
        speedMps: (lengths.length * 25) / elapsed,
        avgSwolf: 47,
      },
    ],
  };
}

function highlightsOf(a: DemoActivity): Result<'feed.highlights'> {
  const route = a.route;
  const prRoute = route !== null && newestFirst.find((x) => x.route === route) === a;
  return {
    indicators: [],
    routeHighlights:
      route === null
        ? []
        : [
            {
              activityId: a.id,
              routeId: `route-${route}`,
              routeName: ROUTE_NAMES[route] ?? '',
              label: prRoute ? `${ROUTE_NAMES[route] ?? ''} PR` : (ROUTE_NAMES[route] ?? ''),
              isPr: prRoute,
              trend: prRoute ? 1 : 0,
              timeDeltaSeconds: prRoute ? -41 : 18,
              prImprovementSeconds: prRoute ? 41 : null,
            },
          ],
    newGround: a.sport.gps ? [{ activityId: a.id, fraction: 0.12, tiles: 96, newTiles: 11 }] : [],
    strengthCards:
      a.sport.family === 'strength'
        ? [
            {
              activityId: a.id,
              settled: true,
              activeSetCount: 15,
              exerciseCount: 5,
              totalVolumeKg: 6200,
              muscles: MUSCLES.slice(0, 5).map((m, at) => ({
                slug: m.slug,
                intensity: 1 - at / 6,
              })),
            },
          ]
        : [],
  };
}

function sectionObject(index: number): NonNullable<Result<'section.detail'>['section']> {
  const part = sectionPart(index);
  const passes = onRoute(index);
  const row = sectionRows()[index];
  return {
    id: `section-${index}`,
    sectionType: 'auto',
    name: SECTION_NAMES[index] ?? null,
    sportTypes: [ROUTE_SPORT[index] ?? 'Ride'],
    encodedPolyline: encodeTrack(part),
    distanceMeters: sectionLength(index),
    representativeActivityId: passes[0]?.id ?? null,
    activityIds: passes.map((a) => a.id),
    activityPortions: passes.map((a) => ({
      activityId: a.id,
      startIndex: 40,
      endIndex: 160,
      distanceMeters: sectionLength(index),
      direction: 'forward',
    })),
    visitCount: passes.length,
    confidence: 0.9,
    observationCount: passes.length,
    averageSpread: 6.5,
    pointDensity: null,
    scale: null,
    isUserDefined: false,
    stability: 0.92,
    elevationGainM: row?.elevationGainM ?? null,
    avgGradePercent: row?.avgGradePercent ?? null,
    version: 3,
    updatedAt: isoLocal(LIBRARY_END),
    createdAt: isoLocal(LIBRARY_END - 300 * DAY),
    routeIds: [`route-${index}`],
    sourceActivityId: null,
    startIndex: null,
    endIndex: null,
    disabled: false,
    supersededBy: null,
    elevationLossM: row?.elevationLossM ?? null,
    maxGradePercent: row?.maxGradePercent ?? null,
    klass: null,
    isLift: false,
    rankScore: row?.rankScore ?? null,
    sportRankScore: row?.sportRankScore ?? null,
  };
}

function routeGroupOf(index: number): NonNullable<Result<'route.detail'>['group']> {
  const passes = onRoute(index);
  const timed = passes.map((a) => a.seconds);
  const best = passes.reduce((x, y) => (y.seconds < x.seconds ? y : x), passes[0] as DemoActivity);
  return {
    groupId: `route-${index}`,
    representativeId: passes[0]?.id ?? '',
    activityIds: passes.map((a) => a.id),
    bounds: bounds(LOOPS[index] ?? []),
    customName: ROUTE_NAMES[index] ?? null,
    bestTime: Math.min(...timed),
    avgTime: Math.round(timed.reduce((s, t) => s + t, 0) / timed.length),
    bestPace: speedOf(best),
    bestActivityId: best.id,
  };
}

function activityDetail(a: DemoActivity): Result<'activity.detail'> {
  const route = a.route;
  const sets = a.sport.family === 'strength' ? exerciseSets(a).groups : [];
  const day = LOADS.find((d) => d.date === isoLocal(a.start).slice(0, 10));
  const speed = speedOf(a);
  const encounter =
    route === null
      ? []
      : [
          {
            sectionId: `section-${route}`,
            sectionType: 'auto',
            sectionName: SECTION_NAMES[route] ?? '',
            direction: 'forward',
            distanceMeters: sectionLength(route),
            startIndex: 40,
            lapTime: passTime(a, route),
            lapPace: speed,
            isPr: false,
            isComplete: true,
            rank: 3,
            visitCount: onRoute(route).length,
            historyTimes: onRoute(route)
              .slice(-8)
              .map((x) => passTime(x, route)),
            historyActivityIds: onRoute(route)
              .slice(-8)
              .map((x) => x.id),
            historyDates: onRoute(route)
              .slice(-8)
              .map((x) => seconds(x.start)),
          },
        ];
  return {
    exerciseGroups: sets,
    fitnessImpact: day
      ? {
          fitness: day.fitness,
          fatigue: day.fatigue,
          form: day.fitness - day.fatigue,
          fitnessDays: 42,
          fatigueDays: 7,
        }
      : null,
    activityCount: ACTIVITIES.length,
    hasGpsTrack: a.sport.gps,
    sectionCount: route === null ? 0 : 1,
    routeGroups: route === null ? [] : [routeGroupOf(route)],
    representativeSignature: '',
    matchedSections:
      route === null ? [] : [{ ...(sectionRows()[route] as object) } as never].slice(0, 1),
    customSections: [],
    encounters: encounter,
    memberships: [],
    highlights: highlightsOf(a),
    sectionTraces:
      route === null
        ? []
        : [{ sectionId: `section-${route}`, encodedCoords: encodeTrack(sectionPart(route)) }],
    prSectionIds: [],
    maxHr: MAX_HR,
    maxHrSource: 'sportSettings',
    hrZones: zoneBands(a),
    summary: {
      movingTime: a.seconds,
      elapsedTime: Math.round(a.seconds * 1.04),
      averageSpeed: speed,
      maxSpeed: speed * 1.6,
      averageCadence: a.sport.type === 'Run' ? 168 : a.sport.type === 'Ride' ? 86 : null,
      cadenceUnit: a.sport.type === 'Run' ? 'stepsPerMinute' : 'rpm',
    },
    powerZones: a.avgPower ? powerBands(a) : [],
    ledgerChanges: [],
    intervalsId: a.id,
    poolSwim: a.sport.family === 'water' && !a.sport.gps ? poolSwim(a) : null,
    syncFailure: null,
    heldBack: null,
    provenance: 'intervals',
    heatmapHidden: false,
  };
}

function activityRecord(a: DemoActivity): Result<'activity.record'> {
  return {
    record: {
      id: a.id,
      isDetail: true,
      name: a.name,
      sportType: a.sport.type,
      startDateLocal: isoLocal(a.start),
      description: null,
      deviceName: 'Wrist unit',
      movingTime: a.seconds,
      distance: a.distance,
      elevationGain: a.gain,
      avgHr: a.avgHr,
      maxHr: Math.round(a.avgHr * 1.18),
      avgPower: a.avgPower,
      maxPower: a.avgPower ? Math.round(a.avgPower * 3.1) : null,
      calories: Math.round(a.seconds * 0.2),
      trainingLoad: a.load,
      intensity: a.avgPower ? Math.round((a.avgPower / 252) * 100) / 100 : null,
      ftp: a.avgPower ? 252 : null,
      eftp: a.avgPower ? 249 : null,
      trimp: Math.round(a.load * 1.4),
      strainScore: null,
      hrRecovery: 28,
      efficiencyFactor: a.avgPower ? Math.round((a.avgPower / a.avgHr) * 100) / 100 : null,
      decoupling: 2.4,
      metricsSource: null,
      hasWeather: false,
      weatherTemp: null,
      sensorTemp: null,
      feelsLike: null,
      windSpeed: null,
      streamTypes: a.sport.gps
        ? ['time', 'latlng', 'altitude', 'heartrate']
        : ['time', 'heartrate'],
    },
  };
}

/** A warm-up, four hard efforts with recoveries between, and a cool-down, as sample ranges of the streams. A ride only: any other activity holds none. */
function activityIntervals(a: DemoActivity): Result<'activity.intervals'> {
  if (a.sport.type !== 'Ride') return { intervals: { intervals: [] } };
  const samples = (LOOPS[0] as unknown[]).length * 4;
  const step = Math.floor(samples / 11);
  const power = a.avgPower ?? 0;
  const make = (at: number, kind: 'work' | 'recovery' | 'warmup' | 'cooldown') => ({
    id: at,
    kind,
    zone: kind === 'work' ? 4 : kind === 'recovery' ? 1 : 2,
    startTime: seconds(a.start) + Math.round((at * a.seconds) / 11),
    endTime: seconds(a.start) + Math.round(((at + 1) * a.seconds) / 11),
    startIndex: at * step,
    endIndex: (at + 1) * step - 1,
    averageWatts: power
      ? Math.round(power * (kind === 'work' ? 1.35 : kind === 'recovery' ? 0.6 : 0.8))
      : null,
    averageHeartrate: Math.round(a.avgHr * (kind === 'work' ? 1.12 : 0.9)),
    averageSpeed: speedOf(a) * (kind === 'work' ? 1.2 : 0.85),
    movingTime: Math.round(a.seconds / 11),
    distance: Math.round(a.distance / 11),
    label: kind === 'work' ? `Effort ${Math.ceil(at / 2)}` : null,
  });
  const kinds = [
    'warmup',
    'work',
    'recovery',
    'work',
    'recovery',
    'work',
    'recovery',
    'work',
    'recovery',
    'cooldown',
  ] as const;
  return { intervals: { intervals: kinds.map((kind, at) => make(at, kind)) } };
}

function activitySections(a: DemoActivity): Result<'activity.sections'> {
  return { sections: a.route === null ? [] : [sectionObject(a.route)] };
}

function activityOverlay(a: DemoActivity) {
  if (a.route === null) return geoText([]);
  const part = sectionPart(a.route);
  const best = onRoute(a.route).reduce(
    (x, y) => (passTime(y, a.route as number) < passTime(x, a.route as number) ? y : x),
    a
  );
  return geoText([
    lineFeature(part, { kind: 'section', id: `section-${a.route}` }),
    lineFeature(part.slice(4, 24), { kind: 'portion', id: `section-${a.route}` }),
    ...(best === a
      ? [
          {
            type: 'Feature',
            properties: { kind: 'pr', id: `section-${a.route}` },
            geometry: {
              type: 'Point',
              coordinates: [(part[0] as [number, number])[1], (part[0] as [number, number])[0]],
            },
          },
        ]
      : []),
  ]);
}

// ── Routes and sections ──

type Attempt = { a: DemoActivity; time: number };

const attemptsOn = (index: number): Attempt[] =>
  onRoute(index).map((a) => ({ a, time: passTime(a, index) }));

const CURVE_POINTS = 40;

/**
 * Each attempt's time ahead of (negative) or behind (positive) the fastest one along the route:
 * zero at the start, the whole gap at the end, a gentle wobble between. The typical line is the
 * median of the others.
 */
function deltaCurves(
  attempts: Attempt[],
  distance: number
): Result<'section.performance'>['curves'] {
  const reference = attempts.reduce((x, y) => (y.time < x.time ? y : x), attempts[0] as Attempt);
  const along = (time: number, index: number) =>
    range(CURVE_POINTS).map((k) => {
      const share = k / (CURVE_POINTS - 1);
      return (time - reference.time) * (share + 0.06 * Math.sin(share * 9 + index));
    });
  const lines = attempts.map((attempt, index) => along(attempt.time, index));
  const others = lines.filter((_, index) => attempts[index] !== reference);
  const median = (values: number[]) => {
    const sorted = [...values].sort((x, y) => x - y);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };
  return {
    gridStepM: distance / (CURVE_POINTS - 1),
    splitStepM: distance / 10,
    sectionLengthM: distance,
    forward: {
      referenceActivityId: reference.a.id,
      referenceSource: 'record',
      laps: attempts.map((attempt, index) => ({
        activityId: attempt.a.id,
        startIndex: 40,
        activityDate: seconds(attempt.a.start),
        deltaSecs: singles(lines[index] as number[]),
        splitDeltaSecs: singles([]),
        splitSecs: singles([]),
        endDeltaSecs: attempt.time - reference.time,
      })),
      missing: [],
      peakDeltaSecs: Math.max(...lines.flat().map(Math.abs)),
      splitSummary: null,
      typicalDeltaSecs: singles(
        range(CURVE_POINTS).map((k) => median(others.map((line) => line[k] as number)))
      ),
      previousRecord: null,
      defaultReference: 'record',
    },
    reverse: null,
  };
}

/** Grid points of the demo's trend band, and its kernel's width in seconds. */
const TREND_POINTS = 12;
const TREND_BANDWIDTH = (60 * DAY) / 1000;

/**
 * The demo's trend band over the attempts: a Gaussian-weighted mean of the times on a grid of dates,
 * with one weighted standard deviation either side. Null with fewer than two attempts.
 */
function demoTrendBand(
  attempts: Attempt[]
): Result<'section.performance'>['trendCurves']['forwardTime'] {
  if (attempts.length < 2) return null;
  const dates = attempts.map(({ a }) => seconds(a.start));
  const first = Math.min(...dates);
  const last = Math.max(...dates);
  return range(TREND_POINTS).map((step) => {
    const at = first + ((last - first) * step) / (TREND_POINTS - 1);
    const weights = dates.map((date) => Math.exp(-(((date - at) / TREND_BANDWIDTH) ** 2) / 2));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const mean =
      attempts.reduce((sum, { time }, i) => sum + (weights[i] as number) * time, 0) / total;
    const variance =
      attempts.reduce((sum, { time }, i) => sum + (weights[i] as number) * (time - mean) ** 2, 0) /
      total;
    const spread = Math.sqrt(variance);
    return { time: Math.round(at), value: mean, lower: mean - spread, upper: mean + spread };
  });
}

/** A time band as a speed band over a distance: slower times are lower speeds. */
function speedBandOf(
  band: Result<'section.performance'>['trendCurves']['forwardTime'],
  distance: number
): Result<'section.performance'>['trendCurves']['forwardSpeed'] {
  return (
    band?.map((point) => ({
      time: point.time,
      value: distance / point.value,
      lower: distance / point.upper,
      upper: distance / point.lower,
    })) ?? null
  );
}

function performanceData(
  attempts: Attempt[],
  distance: number,
  sport: string
): Result<'section.performance'> {
  const records = attempts.map(({ a, time }) => ({
    activityId: a.id,
    activityName: a.name,
    activityDate: seconds(a.start),
    laps: [
      {
        id: `${a.id}-0`,
        activityId: a.id,
        time,
        pace: distance / time,
        distance,
        direction: 'forward',
        startIndex: 40,
        endIndex: 160,
        avgHr: a.avgHr,
        avgPower: a.avgPower,
        coverage: 1,
        excluded: false,
        outsideDistanceBand: false,
        matchPercentage: 96,
        isRecord: false,
        estimated: false,
      },
    ],
    lapCount: 1,
    bestTime: time,
    bestPace: distance / time,
    bestForwardTime: time,
    bestReverseTime: null,
    bestEstimated: false,
    avgTime: time,
    avgPace: distance / time,
    direction: 'forward',
    sectionDistance: distance,
  }));
  const best = records.reduce((x, y) => (y.bestTime < x.bestTime ? y : x), records[0] as never);
  const times = attempts.map((t) => t.time);
  const average = Math.round(times.reduce((s, t) => s + t, 0) / times.length);
  const fastest = Math.min(...times);
  const slowest = Math.max(...times);
  const width = Math.max(1, Math.ceil((slowest - fastest) / 8));
  const counts = range(9).map(
    (bin) => times.filter((t) => Math.floor((t - fastest) / width) === bin).length
  );
  const years = [...new Set(attempts.map((t) => new Date(t.a.start).getUTCFullYear()))];
  const bestOf = (list: Attempt[]) => {
    const top = list.reduce((x, y) => (y.time < x.time ? y : x), list[0] as Attempt);
    return {
      count: list.length,
      bestTime: top.time,
      bestPace: distance / top.time,
      bestActivityId: top.a.id,
      bestActivityName: top.a.name,
    };
  };
  const progression: Result<'section.performance'>['recordProgression']['forward'] = [];
  let record = Infinity;
  for (const t of attempts) {
    if (t.time < record) {
      progression.push({
        activityId: t.a.id,
        lapId: `${t.a.id}-0`,
        activityDate: seconds(t.a.start),
        sectionTime: t.time,
        speed: distance / t.time,
        improvementSecs: Number.isFinite(record) ? record - t.time : null,
        improvementSpeed: null,
      });
      record = t.time;
    }
  }
  return {
    sportType: sport,
    sportCounts: [{ sportType: sport, count: attempts.length }],
    calendarSummary: {
      years: years.map((year) => {
        const inYear = attempts.filter((t) => new Date(t.a.start).getUTCFullYear() === year);
        return {
          year,
          traversalCount: inYear.length,
          activityCount: inYear.length,
          forward: bestOf(inYear),
          reverse: null,
          months: [...new Set(inYear.map((t) => new Date(t.a.start).getUTCMonth()))].map((m) => {
            const inMonth = inYear.filter((t) => new Date(t.a.start).getUTCMonth() === m);
            return {
              month: m + 1,
              traversalCount: inMonth.length,
              activityCount: inMonth.length,
              forward: bestOf(inMonth),
              reverse: null,
            };
          }),
        };
      }),
      forwardPr: bestOf(attempts),
      reversePr: null,
      sectionDistance: distance,
    },
    performances: {
      records,
      bestForwardRecord: best,
      bestReverseRecord: null,
      bestForwardIsPr: true,
      bestReverseIsPr: false,
      forwardStats: {
        avgTime: average,
        lastActivity: seconds((attempts[attempts.length - 1] as Attempt).a.start),
        count: attempts.length,
        avgSpeed: distance / average,
        outsideBandCount: 0,
      },
      reverseStats: null,
    },
    chartData: {
      points: attempts.map((t) => ({
        lapId: `${t.a.id}-0`,
        activityId: t.a.id,
        activityName: t.a.name,
        activityDate: seconds(t.a.start),
        speed: distance / t.time,
        sectionTime: t.time,
        sectionDistance: distance,
        direction: 'forward',
        isBest: t.time === fastest,
        avgPower: t.a.avgPower,
        outsideDistanceBand: false,
        matchPercentage: 96,
        offScale: 'none' as const,
        recordGapSecs: t.time - fastest,
        recordGapSpeed: distance / fastest - distance / t.time,
        estimated: false,
      })),
      minSpeed: distance / slowest,
      maxSpeed: distance / fastest,
      hasReverseRuns: false,
      bestTimeSecs: fastest,
      bestTimeEstimated: false,
      firstActivityDate: seconds((attempts[0] as Attempt).a.start),
      lastActivityDate: seconds((attempts[attempts.length - 1] as Attempt).a.start),
      totalActivities: attempts.length,
    },
    excludedPoints: [],
    lapRecords: records,
    bestForwardIsRecord: true,
    bestReverseIsRecord: false,
    trendCurves: {
      forwardSpeed: speedBandOf(demoTrendBand(attempts), distance),
      forwardTime: demoTrendBand(attempts),
      reverseSpeed: null,
      reverseTime: null,
    },
    histograms: {
      forward: {
        startSecs: fastest,
        binWidthSecs: width,
        counts,
        edgeSpeeds: null,
        binned: attempts.length,
        unbinnedOutsideBand: 0,
      },
      reverse: null,
    },
    correlations: [],
    correlationFloor: 0.3,
    curves: attempts.length > 1 ? deltaCurves(attempts, distance) : null,
    curvesPending: false,
    efficiencyTrend: null,
    scatterFocus: { forward: null, reverse: null },
    recordProgression: { forward: progression, reverse: [] },
  };
}

function routeAttempts(index: number): Result<'route.attempts'> {
  const list = onRoute(index);
  const performances = list.map((a, at) => ({
    activityId: a.id,
    name: a.name,
    date: seconds(a.start),
    speed: speedOf(a),
    duration: Math.round(a.seconds * 1.04),
    movingTime: a.seconds,
    distance: a.distance,
    elevationGain: a.gain,
    avgHr: a.avgHr,
    avgPower: a.avgPower,
    isCurrent: at === list.length - 1,
    direction: 'forward',
    matchPercentage: 97,
    outsideDistanceBand: false,
    isRecord: false,
  }));
  const best = performances.reduce(
    (x, y) => (y.movingTime < x.movingTime ? y : x),
    performances[0] as never
  );
  const times = list.map((a) => a.seconds);
  const fastest = Math.min(...times);
  const width = Math.max(1, Math.ceil((Math.max(...times) - fastest) / 8));
  return {
    performances,
    activityMetrics: list.map((a) => ({
      activityId: a.id,
      name: a.name,
      date: seconds(a.start),
      distance: a.distance,
      movingTime: a.seconds,
      elapsedTime: Math.round(a.seconds * 1.04),
      elevationGain: a.gain,
      avgHr: a.avgHr,
      avgPower: a.avgPower,
      sportType: a.sport.type,
      trainingLoad: a.load,
      ftp: a.avgPower ? 252 : null,
    })),
    best,
    bestForward: best,
    bestReverse: null,
    currentDirectionBest: best,
    forwardStats: {
      avgTime: Math.round(times.reduce((s, t) => s + t, 0) / times.length),
      lastActivity: seconds((list[list.length - 1] as DemoActivity).start),
      count: list.length,
      avgSpeed: routeLength(index) / (times.reduce((s, t) => s + t, 0) / times.length),
      outsideBandCount: 0,
    },
    reverseStats: null,
    currentRank: 4,
    attemptCount: list.length,
    percentileRank: 71,
    trendCurves: { forwardSpeed: null, forwardTime: null, reverseSpeed: null, reverseTime: null },
    histograms: {
      forward: {
        startSecs: fastest,
        binWidthSecs: width,
        counts: range(9).map(
          (bin) => times.filter((t) => Math.floor((t - fastest) / width) === bin).length
        ),
        edgeSpeeds: null,
        binned: list.length,
        unbinnedOutsideBand: 0,
      },
      reverse: null,
    },
  };
}

function routeDetail(index: number): Result<'route.detail'> {
  const list = onRoute(index);
  return {
    activityCount: list.length,
    group: routeGroupOf(index),
    distanceMeters: routeLength(index),
    elevationGainMeters: Math.round((routeLength(index) / 1000) * 11),
    encodedRepresentative: encodeTrack(LOOPS[index] ?? []),
    excludedActivityIds: [],
    mapSignatures: list.slice(-6).map((a) => {
      const track = trackOf(a);
      return {
        activityId: a.id,
        encodedCoords: encodeTrack(track),
        centerLat: (track[0] as [number, number])[0],
        centerLng: (track[0] as [number, number])[1],
      };
    }),
    missingTimeStreamIds: [],
  };
}

function sectionEventDetails(
  partial: Partial<NonNullable<Result<'section.history'>['history'][number]['details']>>
): NonNullable<Result<'section.history'>['history'][number]['details']> {
  return {
    around: [],
    forkAround: [],
    prs: [],
    prFrom: null,
    prTo: null,
    prSport: null,
    prDirection: null,
    siblings: [],
    version: null,
    reanchoredFrom: null,
    reanchoredTo: null,
    moved: null,
    splitFrom: null,
    splitInto: [],
    boundaries: [],
    summary: null,
    ...partial,
  };
}

function sectionStanding(id: string, index: number): Result<'section.standing'> {
  return {
    id,
    name: `Section ${index + 1}`,
    sportType: ROUTE_SPORT[index] ?? 'Ride',
    distanceMeters: sectionLength(index),
    elevationGainM: null,
    traversalCount: 0,
    best: { forward: null, reverse: null },
    recent: [],
    trend: { windowDays: 365, forward: null, reverse: null },
  };
}

function sectionHistory(index: number): Result<'section.history'> {
  const attempts = attemptsOn(index);
  const best = Math.min(...attempts.map((t) => t.time));
  const sport = ROUTE_SPORT[index] ?? 'Ride';
  return {
    history: [
      {
        id: index * 10 + 1,
        at: isoLocal(LIBRARY_END - 300 * DAY),
        kind: 'formed',
        details: null,
        geometryVersion: 1,
      },
      {
        id: index * 10 + 2,
        at: isoLocal(LIBRARY_END - 140 * DAY),
        kind: 'recut',
        details: sectionEventDetails({ version: 2, moved: false }),
        geometryVersion: 2,
      },
      {
        id: index * 10 + 3,
        at: isoLocal(LIBRARY_END - 20 * DAY),
        kind: 'pr_rebased',
        details: sectionEventDetails({
          prs: [{ sport, direction: 'forward', time: best }],
          prFrom: best + 9,
          prTo: best,
          prSport: sport,
          prDirection: 'forward',
        }),
        geometryVersion: 2,
      },
    ],
    geometryVersions: [
      { version: 1, createdAt: isoLocal(LIBRARY_END - 300 * DAY), milestone: true, pinned: false },
      { version: 2, createdAt: isoLocal(LIBRARY_END - 140 * DAY), milestone: false, pinned: false },
    ],
    pinnedVersion: null,
    names: attempts.map((t) => ({
      activityId: t.a.id,
      name: t.a.name,
      date: seconds(t.a.start),
    })),
  };
}

/** The track of the ride a section was cut from, and where the section's line runs on it. */
function sectionExtension(index: number): Result<'section.extensionTrack'> {
  const reference = onRoute(index)[0];
  const part = sectionPart(index);
  return {
    activityId: reference?.id ?? '',
    encodedTrack: encodeTrack(reference ? trackOf(reference) : (LOOPS[index] ?? [])),
    sectionStartIdx: 10,
    sectionEndIdx: 10 + part.length - 1,
  };
}

/** A neighbouring section that shares most of this one's ground, drawn a few metres to one side of it. */
function mergeCandidate(index: number): Result<'section.detail'>['mergeCandidates'][number] {
  const other = (index + 1) % LOOPS.length;
  return {
    sectionId: `section-${other}`,
    name: SECTION_NAMES[other] ?? null,
    sportTypes: [ROUTE_SPORT[other] ?? 'Ride'],
    distanceMeters: sectionLength(index) - 120,
    visitCount: onRoute(other).length,
    overlapPct: 62,
    centerDistanceMeters: 55,
    encodedPolyline: encodeTrack(
      sectionPart(index).map(([lat, lng]) => [lat + 0.0005, lng + 0.0004] as [number, number])
    ),
  };
}

function sectionDetail(index: number): Result<'section.detail'> {
  const history = sectionHistory(index);
  const part = sectionPart(index);
  return {
    activityCount: onRoute(index).length,
    section: sectionObject(index),
    retirement: null,
    mergeCandidates: [mergeCandidate(index)],
    excludedActivityIds: [],
    hasOriginalBounds: true,
    activityRows: onRoute(index).map((a) => ({
      activityId: a.id,
      name: a.name,
      sportType: a.sport.type,
      startTime: seconds(a.start),
      distance: a.distance,
      movingTime: a.seconds,
      averageSpeed: speedOf(a),
    })),
    mapSignatures: onRoute(index)
      .slice(-6)
      .map((a) => ({
        activityId: a.id,
        encodedCoords: encodeTrack(part),
        centerLat: (part[0] as [number, number])[0],
        centerLng: (part[0] as [number, number])[1],
      })),
    missingTimeStreamIds: [],
    history: history.history,
    geometryVersions: history.geometryVersions,
    pinnedVersion: null,
  };
}

// ── Strength ──

const summaryWeek = (start: number, scale: number): Result<'strength.screen'>['summary'] => {
  const volumes = MUSCLES.map((m, at) => {
    const sets = Math.round((9 - at) * scale);
    return {
      slug: m.slug,
      primarySets: sets,
      secondarySets: Math.round(sets / 3),
      weightedSets: sets + sets / 6,
      totalReps: sets * 9,
      volumeKg: sets * 9 * 40,
      exerciseNames: [STRENGTH[at % STRENGTH.length]?.label ?? ''],
      shade: Math.min(5, Math.max(1, Math.ceil((sets / 9) * 5))),
    };
  });
  return {
    startTs: seconds(start),
    muscleVolumes: volumes,
    activityCount: Math.max(1, Math.round(2 * scale)),
    totalSets: volumes.reduce((s, v) => s + v.primarySets, 0),
    balance: [
      ['chest_back', 0, 3],
      ['quads_hamstrings', 5, 7],
    ].map(([id, left, right]) => {
      const l = volumes[left as number];
      const r = volumes[right as number];
      const lw = l?.weightedSets ?? 0;
      const rw = r?.weightedSets ?? 0;
      const ratio = Math.min(lw, rw) === 0 ? null : Math.max(lw, rw) / Math.min(lw, rw);
      return {
        id: id as string,
        leftSlug: l?.slug ?? '',
        rightSlug: r?.slug ?? '',
        leftWeightedSets: lw,
        rightWeightedSets: rw,
        dominantSlug: lw === rw ? null : lw > rw ? (l?.slug ?? null) : (r?.slug ?? null),
        ratio,
        status:
          ratio === null
            ? 'one-sided'
            : ratio < 1.35
              ? 'balanced'
              : ratio < 2
                ? 'watch'
                : 'imbalanced',
      };
    }),
    maxWeightedSets: Math.max(...volumes.map((v) => v.weightedSets)),
  };
};

function strengthScreen(): Result<'strength.screen'> {
  return {
    summary: summaryWeek(LIBRARY_END - 27 * DAY, 1),
    weekly: range(12).map((at) =>
      summaryWeek(LIBRARY_END - (12 - at) * 7 * DAY, 0.7 + (at % 4) * 0.2)
    ),
    progressions: MUSCLES.map((m, at) => ({
      muscleSlug: m.slug,
      weeklyWeightedSets: range(12).map((week) => 6 + ((week + at) % 5) + week / 6),
      recentAverage: 9 - at / 2,
      baselineAverage: 8 - at / 3,
      peakWeightedSets: 12,
      changePct: 8 - at,
      trend: at % 3 === 0 ? 'rising' : 'steady',
      signalDelta: null,
    })),
    exercises: MUSCLES.map((m, at) => ({
      muscleSlug: m.slug,
      exercises: [STRENGTH[at % STRENGTH.length], STRENGTH[(at + 3) % STRENGTH.length]].map(
        (spec, order) => ({
          exerciseName: spec?.label ?? '',
          exerciseCategory: spec?.category ?? 0,
          totalSets: 36 - order * 8,
          totalReps: 320 - order * 60,
          volumeKg: 14_000 - order * 3000,
          activityCount: 22 - order * 5,
          isPrimary: order === 0,
        })
      ),
    })),
    owedCount: 0,
  };
}

function exerciseDetail(spec: (typeof STRENGTH)[number]): Result<'strength.exercise'> {
  const sessions = strengthActivities
    .filter((a) => exercisesOf(a).some((e) => e.spec.category === spec.category))
    .slice(-14)
    .map((a) => {
      const hit = exerciseSets(a).groups.find((g) => g.exerciseCategory === spec.category);
      const best = hit?.bestSet as NonNullable<typeof hit>['bestSet'] & object;
      const kg = best?.weightKg ?? null;
      return {
        activityId: a.id,
        activityName: a.name,
        date: seconds(a.start),
        bestSet: best,
        estimatedOneRepMaxKg:
          kg === null ? null : Math.round(kg * (1 + (best?.repetitions ?? 1) / 30) * 10) / 10,
      };
    });
  return { exerciseCategory: spec.category, exerciseName: spec.label, sessions };
}

const draftSet = (reps: number | null, weightKg: number | null) => ({
  reps,
  weightKg,
  durationSecs: null,
  side: null,
  warmUp: false,
});

const draftExercises = (picks: readonly (typeof STRENGTH)[number][]) =>
  picks
    .map((spec, at) => ({
      category: spec.category,
      name: null,
      groupNo: null,
      restSecs: 90,
      sets: range(3).map((n) => draftSet(10 - n, spec.base ? spec.base + n * 2.5 : null)),
      order: at,
    }))
    .map(({ order: _order, ...rest }) => rest);

function liveSession(): NonNullable<Result<'strength.live'>['session']> {
  const picks = [STRENGTH[0], STRENGTH[3], STRENGTH[4]] as (typeof STRENGTH)[number][];
  return {
    id: 'live-1',
    weightUnit: 'kilogram',
    begun: true,
    startedAt: seconds(LIBRARY_END) - 1500,
    exercises: picks.map((spec, at) => ({
      category: spec.category,
      name: null,
      labelKey: `exercise.${spec.category}`,
      displayName: spec.label,
      equipment: spec.equipment,
      oneSided: false,
      groupNo: null,
      restSecs: 90,
      sets: range(3).map((n) => ({
        reps: 10 - n,
        weightKg: spec.base + n * 2.5,
        displayWeight: spec.base + n * 2.5,
        durationSecs: null,
        side: null,
        warmUp: false,
        done: at === 0 || (at === 1 && n < 1),
      })),
    })),
    groups: [],
    currentExercise: 1,
    currentSet: 1,
    restStartedAt: seconds(LIBRARY_END) - 40,
    notes: [],
  };
}

function strengthLive(): Result<'strength.live'> {
  return {
    session: liveSession(),
    focus: {
      phase: 'rest',
      current: {
        exerciseCategory: 23,
        exerciseName: null,
        setNumber: 2,
        setCount: 3,
        reps: 9,
        weightKg: 57.5,
        displayWeight: 57.5,
        weightUnit: 'kilogram',
        weightStep: 2.5,
        weightDownKg: 55,
        weightUpKg: 60,
        durationSecs: null,
        warmUp: false,
      },
      previous: { exerciseCategory: 0, exerciseName: null, setsDone: 3, setCount: 3 },
      next: { exerciseCategory: 24, exerciseName: null, setsDone: 0, setCount: 3 },
      restStartedAt: seconds(LIBRARY_END) - 40,
      restSecs: 90,
      restEndsAt: seconds(LIBRARY_END) + 50,
    },
  };
}

const WORKOUTS = [
  {
    id: 'workout-1',
    name: 'Upper body',
    picks: [STRENGTH[0], STRENGTH[3], STRENGTH[4], STRENGTH[6]],
  },
  { id: 'workout-2', name: 'Lower body', picks: [STRENGTH[1], STRENGTH[2], STRENGTH[7]] },
  { id: 'workout-3', name: 'Pull day', picks: [STRENGTH[5], STRENGTH[3], STRENGTH[6]] },
] as const;

function workoutAnswer(id: string): Result<'strength.workout'> {
  const hit = WORKOUTS.find((w) => w.id === id) ?? WORKOUTS[0];
  return {
    workout: {
      id: hit.id,
      name: hit.name,
      exercises: draftExercises(hit.picks),
      groups: [],
    },
  };
}

function strengthGroups(): Result<'strength.groups'> {
  return {
    groups: WORKOUTS.map((w, at) => ({
      signature: w.id,
      times: 14 - at * 3,
      lastDone: seconds(LIBRARY_END) - (at + 1) * 4 * 86_400,
      latestActivityId: (strengthActivities[strengthActivities.length - 1 - at] as DemoActivity).id,
      muscles: MUSCLES.slice(at, at + 4).map((m, order) => ({
        slug: m.slug,
        intensity: 1 - order / 5,
      })),
      equipment: [...new Set(w.picks.map((p) => p.equipment))],
      exercises: draftExercises(w.picks),
    })),
  };
}

// ── Recordings ──

const RECORDINGS: Result<'recordings.list'>['recordings'] = [
  ['Morning ride', 'Ride', 5_400, 38_000],
  ['Easy run', 'Run', 2_700, 8_100],
  ['Evening ride', 'Ride', 3_600, 26_500],
].map(([name, type, duration, distance], at) => ({
  id: `recording-${at + 1}`,
  kind: 'ride',
  fitPath: `recordings/recording-${at + 1}.fit`,
  streamsPath: null,
  activityType: type as string,
  name: name as string,
  startTime: LIBRARY_END - (at + 1) * 2 * DAY,
  durationSeconds: duration as number,
  distanceMeters: distance as number,
  elevationGain: 310 - at * 90,
  avgHeartrate: 138 + at * 4,
  pairedEventId: null,
  createdAt: LIBRARY_END - (at + 1) * 2 * DAY,
  uploadStatus: at === 2 ? 'pending' : 'uploaded',
  retryCount: 0,
  lastAttemptAt: null,
  lastError: null,
  intervalsActivityId: at === 2 ? null : `i${900_000 + at}`,
  engineActivityId: null,
  engineReconciled: false,
  athleteId: 'i100001',
  notes: null,
  rpe: at === 0 ? 6 : null,
  rpeSent: at === 0,
}));

// ── Planned events ──

function plannedEvents(): Result<'insights.plannedEvents'> {
  const day = (n: number) => new Date(LIBRARY_END + n * DAY).toISOString().slice(0, 10);
  return {
    events: [
      {
        id: 1,
        name: 'Threshold intervals',
        day: day(1),
        sport: 'Ride',
        category: 'workout',
        target: 'power',
        movingTime: 4_500,
        trainingLoad: 78,
        lines: [
          {
            kind: 'work',
            text: '15m warm-up',
            durationSeconds: 900,
            distanceMetres: null,
            targets: [],
          },
          {
            kind: 'work',
            text: '3x10m threshold',
            durationSeconds: 1_800,
            distanceMetres: null,
            targets: [
              {
                metric: 'power',
                low: 0.95,
                high: 1.05,
                units: '%ftp',
                absolute: { low: 240, high: 265, units: 'watts' },
              },
            ],
          },
          {
            kind: 'rest',
            text: '5m easy',
            durationSeconds: 300,
            distanceMetres: null,
            targets: [],
          },
        ],
        bar: [
          { seconds: 900, zone: 2, rest: false },
          { seconds: 600, zone: 4, rest: false },
          { seconds: 300, zone: 1, rest: true },
          { seconds: 600, zone: 4, rest: false },
          { seconds: 300, zone: 1, rest: true },
          { seconds: 600, zone: 4, rest: false },
        ],
      },
      {
        id: 2,
        name: 'Lake half marathon',
        day: day(24),
        sport: 'Run',
        category: 'race',
        target: null,
        movingTime: null,
        trainingLoad: null,
        lines: [],
        bar: [],
      },
    ],
  };
}

// ── Best efforts ──

function bestEfforts(): Result<'fitness.bestEfforts'> {
  const rides = ACTIVITIES.filter((a) => a.sport.type === 'Ride');
  const named = (a: DemoActivity | undefined) =>
    a ? { activityId: a.id, name: a.name, date: seconds(a.start) } : null;
  const checkpoints = [5, 60, 300, 1200, 3600];
  const watts = [920, 410, 330, 268, 238];
  return {
    sports: [
      {
        sport: 'Ride',
        fetched: true,
        efforts: checkpoints.map((checkpoint, at) => ({
          kind: 'duration' as const,
          checkpoint,
          value: watts[at] as number,
          time: checkpoint,
          activityId: rides[at]?.id ?? null,
          wattsPerKg: (watts[at] as number) / 71.4,
          wkgActivityId: rides[at]?.id ?? null,
          activity: named(rides[at]),
        })),
      },
    ],
    climbing: [
      {
        sport: 'Ride',
        owed: 0,
        sourceExcluded: 0,
        bests: [
          {
            label: '5 min',
            windowS: 300,
            vam: 1_180,
            wattsPerKg: 4.4,
            activityId: rides[0]?.id ?? null,
            activity: named(rides[0]),
          },
          {
            label: '20 min',
            windowS: 1200,
            vam: 980,
            wattsPerKg: 3.8,
            activityId: rides[1]?.id ?? null,
            activity: named(rides[1]),
          },
        ],
      },
    ],
  };
}

function retired(): Result<'sections.retired'> {
  return {
    retired: [
      {
        section: {
          sectionId: 'section-old-1',
          kind: 'merged',
          at: isoLocal(LIBRARY_END - 90 * DAY),
          into: 'section-0',
          versions: [1],
          name: 'Vineyard Climb (short)',
          distanceMeters: 420,
          visitCount: 6,
          restorableVersion: 1,
        },
        encodedPolyline: encodeTrack(sectionPart(0).slice(0, 12)),
      },
    ],
    current: range(LOOPS.length).map((index) => ({
      id: `section-${index}`,
      name: SECTION_NAMES[index] ?? null,
      isUserDefined: false,
      pinned: false,
      hidden: false,
      supersededBy: null,
      distanceMeters: sectionLength(index),
      visitCount: onRoute(index).length,
      encodedPolyline: encodeTrack(sectionPart(index)),
    })),
    pairs: [
      { retiredId: 'section-old-1', currentId: 'section-0', link: 'supersedes', overlap: 0.74 },
    ],
    pairsPending: false,
  };
}

function lastTime(): Result<'strength.lastTime'> {
  return { lastTime: { daysAgo: 6, sets: range(3).map((n) => draftSet(10 - n, 60 + n * 2.5)) } };
}

// ── The answers ──

const known = newestFirst.slice(0, 60);
/** Every activity of the library, so the phone answers for one the feed does not list with its own record, never another's. */
const everyActivity = newestFirst;
const groupIds = range(LOOPS.length).map((index) => `route-${index}`);
const sectionIds = range(LOOPS.length).map((index) => `section-${index}`);

/** What a method answers for one key, ahead of its default: by method and then the id, group, section or exercise asked for. */
export function keyedResults(): Record<string, Rows<unknown>> {
  const forActivities = <T>(
    make: (a: DemoActivity) => T,
    list: readonly DemoActivity[] = everyActivity
  ) => Object.fromEntries(list.map((a) => [a.id, make(a)]));
  return {
    'activity.summary': forActivities((a) => activityDetail(a).summary),
    'activity.streams': forActivities(streams),
    'activity.detail': forActivities(activityDetail),
    'activity.record': forActivities(activityRecord),
    'activity.intervals': forActivities(activityIntervals),
    'activity.sections': forActivities(activitySections),
    'activity.exerciseSets': forActivities(exerciseSets),
    'geo.track': forActivities((a) => geoText(a.route === null ? [] : [lineFeature(trackOf(a))])),
    'geo.activityOverlay': forActivities(activityOverlay),
    'route.detail': Object.fromEntries(groupIds.map((id, at) => [id, routeDetail(at)])),
    'route.performance': Object.fromEntries(
      groupIds.map((id, at) => [
        id,
        performanceData(
          onRoute(at).map((a) => ({ a, time: a.seconds })),
          routeLength(at),
          ROUTE_SPORT[at] ?? 'Ride'
        ),
      ])
    ),
    'route.attempts': Object.fromEntries(groupIds.map((id, at) => [id, routeAttempts(at)])),
    'section.detail': Object.fromEntries(sectionIds.map((id, at) => [id, sectionDetail(at)])),
    'section.performance': Object.fromEntries(
      sectionIds.map((id, at) => [
        id,
        performanceData(attemptsOn(at), sectionLength(at), ROUTE_SPORT[at] ?? 'Ride'),
      ])
    ),
    'section.standing': Object.fromEntries(
      sectionIds.map((id, at) => [id, sectionStanding(id, at)])
    ),
    'section.history': Object.fromEntries(sectionIds.map((id, at) => [id, sectionHistory(at)])),
    'section.extensionTrack': Object.fromEntries(
      sectionIds.map((id, at) => [id, sectionExtension(at)])
    ),
    'section.excluded': Object.fromEntries(sectionIds.map((id) => [id, { activityIds: [] }])),
    'geo.route': Object.fromEntries(
      groupIds.map((id, at) => [
        id,
        geoText([lineFeature(LOOPS[at] ?? [], { groupId: id, palette: at })]),
      ])
    ),
    'geo.routeLatest': Object.fromEntries(
      groupIds.map((id, at) => [
        id,
        geoText([
          lineFeature(trackOf(onRoute(at)[onRoute(at).length - 1] as DemoActivity), {
            palette: at,
          }),
        ]),
      ])
    ),
    'geo.routeAttempts': Object.fromEntries(
      groupIds.map((id, at) => [
        id,
        geoText(
          onRoute(at).map((activity) => lineFeature(trackOf(activity), { activityId: activity.id }))
        ),
      ])
    ),
    'geo.section': Object.fromEntries(
      sectionIds.map((id, at) => [
        id,
        geoText([lineFeature(sectionPart(at), { sectionId: id, palette: at })]),
      ])
    ),
    'geo.sectionVersion': Object.fromEntries(
      sectionIds.map((id, at) => [
        id,
        geoText([lineFeature(sectionPart(at), { sectionId: id, palette: at })]),
      ])
    ),
    'geo.sectionPasses': Object.fromEntries(
      sectionIds.map((id, at) => [
        id,
        geoText(
          onRoute(at)
            .slice(-12)
            .map((a) => lineFeature(trackOf(a).slice(40, 160), { activityId: a.id }))
        ),
      ])
    ),
    'strength.exercise': Object.fromEntries(
      STRENGTH.map((spec) => [String(spec.category), exerciseDetail(spec)])
    ),
    'strength.workout': Object.fromEntries(WORKOUTS.map((w) => [w.id, workoutAnswer(w.id)])),
    'recordings.get': Object.fromEntries(RECORDINGS.map((r) => [r.id, { recording: r }])),
  };
}

/** The library's span as the engine answers it: every start, and only the positive distances and times. */
function filterBoundsOf(library: readonly DemoActivity[]): Result<'feed.filterBounds'> {
  const distances = library.map((a) => a.distance).filter((d) => d > 0);
  const times = library.map((a) => a.seconds).filter((s) => s > 0);
  const starts = library.map((a) => a.start);
  return {
    oldestTs: Math.min(...starts) / 1000,
    newestTs: Math.max(...starts) / 1000,
    minDistance: Math.min(...distances),
    maxDistance: Math.max(...distances),
    minMovingTime: Math.min(...times),
    maxMovingTime: Math.max(...times),
  };
}

/** The answers the base file does not hold, for every other method of the protocol. */
export function moreResults(
  methods: readonly string[]
): Omit<DemoResults, keyof ReturnType<typeof baseResults>> {
  const keyed = keyedResults();
  const first = <M extends string>(method: M) => Object.values(keyed[method] ?? {})[0] as never;
  const shown = known.find((a) => a.sport.type === 'Ride') as DemoActivity;
  return {
    'link.hello': helloOf({ methods: [...methods], device: 'Sam’s phone' }),
    'feed.highlights': {
      indicators: [],
      routeHighlights: known.flatMap((a) => highlightsOf(a).routeHighlights).filter((h) => h.isPr),
      newGround: known.flatMap((a) => highlightsOf(a).newGround),
      strengthCards: known.flatMap((a) => highlightsOf(a).strengthCards),
    },
    'feed.filterBounds': filterBoundsOf(everyActivity),
    'activity.summary': activityDetail(shown).summary,
    'activity.detail': activityDetail(shown),
    'activity.record': activityRecord(shown),
    'activity.streams': streams(shown),
    'activity.intervals': activityIntervals(shown),
    'activity.sections': activitySections(shown),
    'activity.exerciseSets': exerciseSets(
      strengthActivities[strengthActivities.length - 1] as DemoActivity
    ),
    'insights.plannedEvents': plannedEvents(),
    'insights.workoutSections': {
      sections: range(3).map((index) => {
        const times = attemptsOn(index).map((t) => t.time);
        const best = Math.min(...times);
        return {
          id: `section-${index}`,
          name: SECTION_NAMES[index] ?? '',
          prTimeSecs: best,
          previousBestTimeSecs: best + 7,
          lastTimeSecs: times[times.length - 1] ?? null,
          daysSinceLast: 4 + index * 5,
          prDaysAgo: 20 + index * 15,
          trend: index === 1 ? -1 : 1,
        };
      }),
    },
    'route.detail': first('route.detail'),
    'route.performance': first('route.performance'),
    'route.attempts': first('route.attempts'),
    'section.detail': first('section.detail'),
    'section.performance': first('section.performance'),
    'section.standing': first('section.standing'),
    'section.history': first('section.history'),
    'section.extensionTrack': first('section.extensionTrack'),
    'section.excluded': { activityIds: [] },
    'sections.retired': retired(),
    'fitness.bestEfforts': bestEfforts(),
    'strength.screen': strengthScreen(),
    'strength.exercise': exerciseDetail(STRENGTH[0]),
    'strength.muscle': {
      slug: 'chest',
      exercises: [
        { name: 'Bench press', role: 'primary', sets: 36, reps: 330, volumeKg: 20_500 },
        { name: 'Shoulder press', role: 'secondary', sets: 24, reps: 220, volumeKg: 5_800 },
      ],
      totalSets: 60,
      totalReps: 550,
      volumeKg: 26_300,
      primaryExercises: 1,
      secondaryExercises: 1,
    },
    'strength.picker': {
      rows: STRENGTH.map((spec, at) => ({
        category: spec.category,
        name: 0,
        labelKey: `exercise.${spec.category}`,
        displayName: spec.label,
        equipment: spec.equipment,
        lastDoneDays: 3 + at * 4,
        usuallyNext: at < 2,
      })),
      equipment: ['barbell', 'dumbbell', 'bodyweight'],
      muscles: MUSCLES,
    },
    'strength.lastTime': lastTime(),
    'strength.groups': strengthGroups(),
    'strength.workouts': {
      workouts: WORKOUTS.map((w, at) => ({
        id: w.id,
        name: w.name,
        exerciseCount: w.picks.length,
        setCount: w.picks.length * 3,
        lastUsedAt: seconds(LIBRARY_END) - (at + 1) * 5 * 86_400,
        createdAt: seconds(LIBRARY_END) - 200 * 86_400,
      })),
    },
    'strength.workout': workoutAnswer(WORKOUTS[0].id),
    'strength.live': strengthLive(),
    'recordings.list': { recordings: RECORDINGS },
    'recordings.get': { recording: RECORDINGS[0] ?? null },
    'geo.track': first('geo.track'),
    'geo.activityOverlay': first('geo.activityOverlay'),
    'geo.route': first('geo.route'),
    'geo.routeLatest': first('geo.routeLatest'),
    'geo.routeAttempts': first('geo.routeAttempts'),
    'geo.section': first('geo.section'),
    'nearby.places': { places: [] },
    'geo.sectionVersion': first('geo.sectionVersion'),
    'geo.sectionPasses': first('geo.sectionPasses'),
    'export.begin': { exportId: 'demo-export' },
    'export.status': {
      state: 'ready',
      bytes: 0,
      rides: 0,
      ridesDone: 0,
      sha256: null,
      error: null,
    },
    'export.read': { length: 0 },
    'export.done': { ok: true },
    'heatmap.tile': { png: heatTilePng('dark') },
    'heatmap.underPoint': { total: 0, truncated: false, traceCap: 100, groups: [], activities: [] },
    'detection.settings': {
      enabled: true,
      strictness: { minMatchPct: 80, endpointThreshold: 50 },
      sectionConfig: {
        proximityThreshold: 50,
        minSectionLength: 200,
        maxSectionLength: 5_000,
        minActivities: 3,
        divergenceThreshold: 30,
      },
    },
    'settings.thresholds': {
      sports: [
        {
          sport: 'Ride',
          hrZones: { upper: [120, 140, 155, 170, 185], source: 'sportSettings' },
          powerZones: [55, 75, 90, 105, 120, 150, 999],
          figures: [
            { field: 'ftp', value: 238, source: 'sportSettings' },
            { field: 'thresholdHr', value: 168, source: 'sportSettings' },
            { field: 'maxHr', value: 189, source: 'file' },
            { field: 'restingHr', value: 47, source: 'file' },
            { field: 'weightKg', value: 71.4, source: 'sportSettings' },
          ],
        },
        {
          sport: 'Run',
          hrZones: { upper: [60, 70, 80, 90, 100], source: 'default' },
          powerZones: [],
          figures: [
            { field: 'ftp', value: null, source: null },
            { field: 'thresholdHr', value: 172, source: 'file' },
            { field: 'maxHr', value: 191, source: 'athlete' },
            { field: 'restingHr', value: 47, source: 'file' },
            { field: 'weightKg', value: 71.4, source: 'sportSettings' },
          ],
        },
      ],
      hrZoneDefaultPercents: [60, 70, 80, 90, 100],
    },
    'section.rename': done,
    'section.setLift': done,
    'section.accept': done,
    'section.acceptMany': { ok: true, ids: [] },
    'section.acceptAll': { ok: true, ids: [] },
    'section.unaccept': done,
    'section.enable': done,
    'section.disable': done,
    'section.setEnabledMany': done,
    'section.delete': { ok: true, departed: [] },
    'section.excludeActivity': done,
    'section.includeActivity': done,
    'section.excludeLap': done,
    'section.includeLap': done,
    'section.editBounds': { ok: true, departed: [] },
    'section.create': { sectionId: 'section-0' },
    'section.boundsPreview': { distanceMeters: 1800, avgGradePercent: 2.5, lapsRemeasured: 6 },
    'section.mergePreview': { dropped: [], lapsRemeasured: 3 },
    'section.merge': { sectionId: 'section-0', departed: [] },
    'section.restore': { ok: true, departed: [] },
    'route.rename': done,
    'route.excludeActivity': done,
    'route.includeActivity': done,
    'route.setReference': done,
    'route.resetReference': done,
    'heatmap.setHidden': done,
    'heatmap.setHiddenMany': done,
    'detection.setEnabled': done,
    'detection.setStrictness': done,
    'detection.setSectionConfig': done,
    'settings.set': done,
    'settings.setThreshold': done,
    'strength.saveWorkout': { id: 'workout-4' },
    'strength.renameWorkout': done,
    'strength.deleteWorkout': done,
    'strength.restoreWorkout': done,
    'strength.liveEdit': { session: liveSession(), prefilledDaysAgo: 6 },
    'import.begin': { importId: 1, offset: 0 },
    'import.commit': { jobId: 1 },
    'import.cancel': done,
    'import.status': {
      state: 'done',
      stopped: null,
      detail: null,
      seen: 42,
      stored: 39,
      alreadyStored: 2,
      failed: 0,
      otherFormat: 1,
      skipped: 0,
      current: null,
      failures: [],
    },
  };
}
