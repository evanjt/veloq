/**
 * A year of mixed training as a scripted phone answers it to the connect page:
 * the same library on every run, drawn from a fixed seed, so a screenshot of a
 * page changes only when the page does.
 */

import { deflateSync } from 'node:zlib';

import type { Methods } from '../../../web/connect/schema';
import type { Script } from './headlessConnectPage';

type Result<M extends keyof Methods> = Methods[M]['result'];

/** The day the library ends on, so no run depends on the clock. */
export const LIBRARY_END = Date.UTC(2026, 10, 8);
const DAY = 86_400_000;

/** A small deterministic generator, so the library is the same every run. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return {
    next,
    between: (low: number, high: number) => low + next() * (high - low),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
  };
}

const HOME = { lat: 46.52, lng: 6.63 };

type Sport = {
  type: string;
  family: 'ride' | 'run' | 'water' | 'foot' | 'strength';
  speed: [number, number];
  hours: [number, number];
  gps: boolean;
  names: string[];
};

const SPORTS: Sport[] = [
  {
    type: 'Ride',
    family: 'ride',
    speed: [6.5, 9.5],
    hours: [1, 3.5],
    gps: true,
    names: ['Lakeside loop', 'Vineyard climb', 'Gruyère ramble', 'Morning spin', 'Col run'],
  },
  {
    type: 'Run',
    family: 'run',
    speed: [2.8, 3.8],
    hours: [0.4, 1.4],
    gps: true,
    names: ['Quay intervals', 'Forest easy', 'Hill repeats', 'Long run', 'Park loop'],
  },
  {
    type: 'Swim',
    family: 'water',
    speed: [0.8, 1.2],
    hours: [0.5, 1],
    gps: false,
    names: ['Pool endurance', 'Technique set', 'Lake swim'],
  },
  {
    type: 'Hike',
    family: 'foot',
    speed: [1.1, 1.6],
    hours: [2, 6],
    gps: true,
    names: ['Ridge traverse', 'Alpine lake', 'Valley walk'],
  },
  {
    type: 'WeightTraining',
    family: 'strength',
    speed: [0, 0],
    hours: [0.6, 1.1],
    gps: false,
    names: ['Strength A', 'Strength B', 'Mobility'],
  },
];

/** The weights by which a day's sport is drawn, bike-heavy as a season is. */
const WEIGHTS = [0.42, 0.3, 0.1, 0.06, 0.12];

export type DemoActivity = {
  id: string;
  sport: Sport;
  name: string;
  start: number;
  seconds: number;
  distance: number;
  gain: number;
  avgHr: number;
  avgPower: number | null;
  load: number;
  route: number | null;
};

/** Closed loops near home, each a different size, that the library repeats. */
function loop(index: number, points: number): [number, number][] {
  const radius = 0.012 + index * 0.009;
  const lean = 0.6 + (index % 3) * 0.25;
  const turn = index * 1.3;
  const out: [number, number][] = [];
  for (let at = 0; at <= points; at++) {
    const angle = (at / points) * Math.PI * 2;
    const wobble = 1 + 0.25 * Math.sin(angle * 3 + turn) + 0.1 * Math.cos(angle * 5);
    out.push([
      HOME.lat + 0.004 * index + Math.sin(angle + turn) * radius * wobble * lean,
      HOME.lng + 0.01 * index + Math.cos(angle + turn) * radius * wobble * 1.4,
    ]);
  }
  return out;
}

const LOOPS = Array.from({ length: 6 }, (_, index) => loop(index, 90));

function buildActivities(): DemoActivity[] {
  const random = generator(20260301);
  const out: DemoActivity[] = [];
  for (let back = 364; back >= 0; back--) {
    const date = LIBRARY_END - back * DAY;
    const weekday = new Date(date).getUTCDay();
    if (random.next() < (weekday === 1 ? 0.55 : 0.22)) continue;
    const roll = random.next();
    let sum = 0;
    const sport = SPORTS[WEIGHTS.findIndex((w) => (sum += w) >= roll)] ?? (SPORTS[0] as Sport);
    const hours = random.between(...sport.hours) * (weekday >= 5 ? 1.3 : 1);
    const seconds = Math.round(hours * 3600);
    const distance = Math.round(seconds * random.between(...sport.speed));
    const route = sport.gps ? Math.floor(random.next() * LOOPS.length) : null;
    const intensity = random.between(0.7, 1.15);
    out.push({
      id: `i${1_000_000 + out.length}`,
      sport,
      name: random.pick(sport.names),
      start: date + Math.round(random.between(5.5, 18) * 3_600_000),
      seconds,
      distance,
      gain: sport.gps ? Math.round((distance / 1000) * random.between(4, 18)) : 0,
      avgHr: Math.round(random.between(118, 158) * intensity),
      avgPower: sport.type === 'Ride' ? Math.round(random.between(150, 215) * intensity) : null,
      load: Math.round(hours * random.between(35, 70) * intensity),
      route,
    });
  }
  return out;
}

export const ACTIVITIES = buildActivities();

const isoLocal = (ms: number) => new Date(ms).toISOString().slice(0, 19);

// ── The track encoding the engine writes, and the float runs of a stream ──

function varint(value: number, into: number[]) {
  let rest = value;
  while (rest >= 128) {
    into.push((rest % 128) | 128);
    rest = Math.floor(rest / 128);
  }
  into.push(rest);
}

const zigzag = (value: number) => (value < 0 ? -value * 2 - 1 : value * 2);

/** `codec::encode_polyline` for points without elevation, as base64. */
export function encodeTrack(points: readonly (readonly [number, number])[]): string {
  const bytes: number[] = [];
  varint(points.length, bytes);
  bytes.push(0);
  let lat = 0;
  let lng = 0;
  for (const [a, b] of points) {
    const la = Math.round(a * 1e6);
    const lo = Math.round(b * 1e6);
    varint(zigzag(la - lat), bytes);
    varint(zigzag(lo - lng), bytes);
    lat = la;
    lng = lo;
  }
  return Buffer.from(bytes).toString('base64');
}

function floats(values: readonly number[]): string {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, at) => buffer.writeFloatLE(value, at * 4));
  return buffer.toString('base64');
}

// ── Heat tile ──

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

/** A 256 px tile of soft orange blotches on transparency, which the heatmap layer overlays. */
export function heatTilePng(): string {
  const size = 256;
  const raw = Buffer.alloc(size * (1 + size * 4));
  const spots = [
    [70, 90, 60],
    [170, 150, 45],
    [110, 200, 35],
    [200, 60, 30],
  ];
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    for (let x = 0; x < size; x++) {
      let heat = 0;
      for (const [cx, cy, r] of spots as [number, number, number][]) {
        heat = Math.max(heat, 1 - Math.hypot(x - cx, y - cy) / (r as number));
      }
      const at = row + 1 + x * 4;
      raw[at] = 255;
      raw[at + 1] = Math.round(120 + 100 * heat);
      raw[at + 2] = 40;
      raw[at + 3] = heat > 0 ? Math.round(200 * heat) : 0;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

// ── Answers ──

const withTrack = ACTIVITIES.filter((a) => a.route !== null);

function card(a: DemoActivity): Result<'feed.page'>['cards'][number] {
  return {
    id: a.id,
    intervalsWebId: a.id,
    sportType: a.sport.type,
    name: a.name,
    startDateLocal: isoLocal(a.start),
    distance: a.distance || null,
    movingTime: a.seconds,
    elevationGain: a.gain || null,
    avgHr: a.avgHr,
    avgPower: a.avgPower,
    trainingLoad: a.load,
    metricsSource: null,
    calories: Math.round(a.seconds * 0.2),
    hasWeather: false,
    averageWeatherTemp: null,
    skylineChartBytes: null,
    hasGps: a.sport.gps,
    hasAltitude: a.sport.gps,
    syncFailure: null,
    stub: 'notStub',
  };
}

const newestFirst = [...ACTIVITIES].reverse();

export const FEED: Result<'feed.page'> = {
  cards: newestFirst.slice(0, 60).map(card),
  matchedCount: ACTIVITIES.length,
  hasMore: ACTIVITIES.length > 60,
  previews: newestFirst
    .slice(0, 60)
    .filter((a) => a.route !== null)
    .map((a) => ({ activityId: a.id, encodedCoords: encodeTrack(LOOPS[a.route as number] ?? []) })),
};

/** Fitness, fatigue and form for each day of the library, from the loads as the standard model reads them. */
function loadSeries() {
  const byDay = new Map<number, number>();
  for (const a of ACTIVITIES) {
    const day = Math.floor(a.start / DAY);
    byDay.set(day, (byDay.get(day) ?? 0) + a.load);
  }
  const first = Math.floor(LIBRARY_END / DAY) - 364;
  let fitness = 28;
  let fatigue = 30;
  const days: { date: string; fitness: number; fatigue: number; load: number }[] = [];
  for (let day = first; day <= Math.floor(LIBRARY_END / DAY); day++) {
    const load = byDay.get(day) ?? 0;
    fitness += (load - fitness) / 42;
    fatigue += (load - fatigue) / 7;
    days.push({
      date: new Date(day * DAY).toISOString().slice(0, 10),
      fitness,
      fatigue,
      load,
    });
  }
  return days;
}

export const LOADS = loadSeries();

const stats = (from: number, to: number) => {
  const inside = ACTIVITIES.filter((a) => a.start >= from && a.start < to);
  return {
    count: inside.length,
    totalDuration: inside.reduce((sum, a) => sum + a.seconds, 0),
    totalDistance: inside.reduce((sum, a) => sum + a.distance, 0),
    totalTss: inside.reduce((sum, a) => sum + a.load, 0),
  };
};

const lastDay = LOADS[LOADS.length - 1] as (typeof LOADS)[number];

const SUMMARY: Result<'feed.summary'> = {
  wellness: {
    fitness: Math.round(lastDay.fitness),
    fitnessTrend: '↑',
    form: Math.round(lastDay.fitness - lastDay.fatigue),
    formTrend: '↓',
    hrv: 62,
    hrvTrend: '→',
    rhr: 47,
    rhrTrend: '↓',
    weight: 71.4,
    weightTrend: '→',
    fatigue: Math.round(lastDay.fatigue),
    fitnessPrevious: null,
    fitnessPreviousDate: null,
    fitnessBasis: null,
    formPrevious: null,
    formPreviousDate: null,
    formBasis: null,
    hrvPrevious: null,
    hrvPreviousDate: null,
    hrvBasis: null,
    rhrPrevious: null,
    rhrPreviousDate: null,
    rhrBasis: null,
    weightPrevious: null,
    weightPreviousDate: null,
    weightBasis: null,
  },
  currentWeek: stats(LIBRARY_END - 6 * DAY, LIBRARY_END + DAY),
  prevWeek: stats(LIBRARY_END - 13 * DAY, LIBRARY_END - 6 * DAY),
  weekHoursTrend: '↑',
  weekCountTrend: '→',
  ftpTrend: {
    latestFtp: 252,
    latestDate: Math.floor(LIBRARY_END / 1000),
    previousFtp: 246,
    previousDate: Math.floor((LIBRARY_END - 60 * DAY) / 1000),
    deltaWatts: 6,
    glyph: '↑',
    lookbackDays: 90,
    sampleCount: 2,
    history: [],
    changes: [],
  },
  runPaceTrend: emptyPace(),
  swimPaceTrend: emptyPace(),
};

function emptyPace() {
  return {
    latestPace: null,
    latestDate: null,
    previousPace: null,
    previousDate: null,
    gainPercent: null,
    deltaSeconds: null,
    glyph: null,
    sampleCount: 0,
    history: [],
  };
}

const SPARKS: Result<'feed.sparklines'> = {
  fitness: LOADS.slice(-42).map((d) => d.fitness),
  fatigue: LOADS.slice(-42).map((d) => d.fatigue),
  form: LOADS.slice(-42).map((d) => d.fitness - d.fatigue),
  hrv: LOADS.slice(-42).map((_, at) => 60 + Math.sin(at / 3) * 6),
  rhr: LOADS.slice(-42).map((_, at) => 47 + Math.cos(at / 4) * 2),
  hrvRead: LOADS.slice(-42).map(() => true),
  rhrRead: LOADS.slice(-42).map(() => true),
  fitnessDelta: 2.4,
  fitnessRiseDays: [],
};

/** The streams of one activity: a lap of its loop with the effort rising and falling. */
function streams(a: DemoActivity): Result<'activity.streams'> {
  const line = LOOPS[a.route ?? 0] ?? [];
  const count = line.length * 4;
  const at = (index: number) => {
    const t = index / (count - 1);
    const p = (t * (line.length - 1)) | 0;
    const q = Math.min(line.length - 1, p + 1);
    const f = t * (line.length - 1) - p;
    const [la, lo] = line[p] as [number, number];
    const [lb, lc] = line[q] as [number, number];
    return [la + (lb - la) * f, lo + (lc - lo) * f] as const;
  };
  const series = (fn: (t: number) => number) =>
    floats(Array.from({ length: count }, (_, i) => fn(i / (count - 1))));
  const latlng = floats(
    Array.from({ length: count }, (_, i) => at(i)).flatMap(([la, lo]) => [la, lo])
  );
  return {
    latlng,
    time: series((t) => t * a.seconds),
    altitude: series((t) => 420 + 90 * Math.sin(t * Math.PI * 4) + 30 * Math.sin(t * 17)),
    heartrate: series((t) => a.avgHr + 14 * Math.sin(t * 11) + 8 * t),
    watts: a.avgPower
      ? series((t) => Math.max(0, a.avgPower! + 70 * Math.sin(t * 23) + 35 * Math.sin(t * 7)))
      : '',
    cadence: series((t) => 84 + 8 * Math.sin(t * 13)),
    velocitySmooth: series((t) => (a.distance / a.seconds) * (1 + 0.25 * Math.sin(t * 9))),
    distance: series((t) => t * a.distance),
    gradeSmooth: series((t) => 6 * Math.sin(t * Math.PI * 4)),
    temp: '',
    wbal: '',
    gap: '',
  };
}

function routeLines(): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: LOOPS.map((line, index) => ({
      type: 'Feature',
      id: `route-${index}`,
      properties: { number: index + 1, name: `Loop ${index + 1}` },
      geometry: { type: 'LineString', coordinates: line.map(([la, lo]) => [lo, la]) },
    })),
  });
}

function sectionLines(): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: LOOPS.map((line, index) => ({
      type: 'Feature',
      id: `section-${index}`,
      properties: { name: `Climb ${index + 1}` },
      geometry: {
        type: 'LineString',
        coordinates: line.slice(10, 40).map(([la, lo]) => [lo, la]),
      },
    })),
  });
}

function bounds(line: readonly (readonly [number, number])[]) {
  const lats = line.map((p) => p[0]);
  const lngs = line.map((p) => p[1]);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

const lengthOf = (line: readonly (readonly [number, number])[]) =>
  line.reduce((sum, p, at) => {
    const q = line[at - 1];
    return q ? sum + Math.hypot((p[0] - q[0]) * 111_000, (p[1] - q[1]) * 77_000) : 0;
  }, 0);

const MAP: Result<'map.screen'> = {
  screen: {
    activityCount: ACTIVITIES.length,
    availableSportTypes: SPORTS.map((s) => s.type),
    categoryCounts: (['ride', 'run', 'water', 'foot', 'strength'] as const).map((family) => ({
      family,
      count: ACTIVITIES.filter((a) => a.sport.family === family).length,
    })),
    activities: withTrack.slice(-120).map((a) => ({
      activityId: a.id,
      sportType: a.sport.type,
      isVirtual: false,
      bounds: bounds(LOOPS[a.route as number] ?? []),
      startLat: (LOOPS[a.route as number] ?? [])[0]?.[0] ?? null,
      startLng: (LOOPS[a.route as number] ?? [])[0]?.[1] ?? null,
      date: Math.floor(a.start / 1000),
      name: a.name,
      distance: a.distance,
      duration: a.seconds,
    })),
    routeCount: LOOPS.length,
    routeLines: null,
    sectionCount: LOOPS.length,
    sections: null,
    emptyReason: null,
    unmapped: { withoutGps: ACTIVITIES.length - withTrack.length, downloading: 0 },
  },
  routeGeneration: 1,
  sectionStamp: 1,
};

function routeGroups(): Result<'routes.screen'>['groups'] {
  return LOOPS.map((line, index) => ({
    groupId: `route-${index}`,
    representativeId: (withTrack.find((a) => a.route === index) ?? withTrack[0]!).id,
    activityCount: withTrack.filter((a) => a.route === index).length,
    customName: `Loop ${index + 1}`,
    bounds: bounds(line),
    distanceMeters: Math.round(lengthOf(line)),
    encodedPolyline: encodeTrack(line),
    sportTypes: ['Ride'],
  }));
}

function sectionRows(): Result<'routes.screen'>['sections'] {
  return LOOPS.map((line, index) => {
    const part = line.slice(10, 40);
    return {
      id: `section-${index}`,
      sectionType: 'auto',
      name: `Climb ${index + 1}`,
      visitCount: 4 + index * 3,
      distanceMeters: Math.round(lengthOf(part)),
      activityCount: 4 + index * 3,
      confidence: 0.9,
      scale: null,
      bounds: bounds(part),
      encodedPolyline: encodeTrack(part),
      sportTypes: ['Ride'],
      isUserDefined: false,
      disabled: false,
      supersededBy: null,
      elevationGainM: 40 + index * 25,
      elevationLossM: 5,
      avgGradePercent: 4 + index,
      maxGradePercent: 9 + index,
      klass: null,
      isLift: false,
      rankScore: 1 - index / 10,
      sportRankScore: 1 - index / 10,
      latestIsRecord: index % 2 === 0,
      trend: index % 3 === 0 ? 1 : -1,
    };
  });
}

const ROUTES: Result<'routes.screen'> = {
  activityCount: ACTIVITIES.length,
  groupCount: LOOPS.length,
  sectionCount: LOOPS.length,
  oldestDate: Math.floor((ACTIVITIES[0] as DemoActivity).start / 1000),
  newestDate: Math.floor(LIBRARY_END / 1000),
  groups: routeGroups(),
  sections: sectionRows(),
  hasMoreGroups: false,
  hasMoreSections: false,
  groupsDirty: false,
  groupsHold: null,
  filteredGroupCount: LOOPS.length,
  filteredSectionCount: LOOPS.length,
  unacceptedAutoCount: 0,
  acceptedAutoCount: LOOPS.length,
  customCount: 0,
  removedCount: 0,
  ledgerRetiredCount: 0,
  archivedRetiredCount: 0,
  availableSportTypes: ['Ride'],
  groupEmptyReason: null,
  sectionEmptyReason: null,
};

const SETTINGS: Result<'settings.get'> = {
  values: [
    { key: 'veloq-unit-preference', value: 'metric' },
    { key: 'veloq-theme-preference', value: null },
  ],
  refused: [],
};

const PROFILE: Result<'settings.profile'> = {
  id: 'i100001',
  name: 'Sam Rivers',
  profileMedium: null,
  sex: 'F',
  measurementPreference: 'meters',
  formAsPercent: false,
  weightKg: 71.4,
  garminSyncsActivities: true,
  garminDownloadsWellness: true,
  garminUploadsWorkouts: false,
};

// ── Fitness ──

const seconds = (ms: number) => Math.floor(ms / 1000);

function range(from: number, to: number) {
  return { startTs: seconds(from), endTs: seconds(to) };
}

function comparison(days: number): Result<'fitness.screen'>['comparisons']['week'] {
  const now = LIBRARY_END + DAY;
  const current = stats(now - days * DAY, now);
  const previous = stats(now - 2 * days * DAY, now - days * DAY);
  const trend = (a: number, b: number) => ({
    glyph: a >= b ? '↑' : '↓',
    percent: b === 0 ? null : Math.round(((a - b) / b) * 100),
    change: a - b,
  });
  return {
    current: range(now - days * DAY, now),
    previous: range(now - 2 * days * DAY, now - days * DAY),
    currentStats: current,
    previousStats: previous,
    count: trend(current.count, previous.count),
    duration: trend(current.totalDuration, previous.totalDuration),
    distance: trend(current.totalDistance, previous.totalDistance),
    load: trend(current.totalTss, previous.totalTss),
    currentCoverage: 'loaded',
    previousCoverage: 'loaded',
  };
}

function months(): Result<'fitness.screen'>['months'] {
  const out: Result<'fitness.screen'>['months'] = [];
  const end = new Date(LIBRARY_END);
  for (let back = 11; back >= 0; back--) {
    const first = Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - back, 1);
    const next = Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - back + 1, 1);
    const at = new Date(first);
    out.push({
      year: at.getUTCFullYear(),
      month: at.getUTCMonth() + 1,
      stats: stats(first, next),
    });
  }
  return out;
}

function fitnessScreen(): Result<'fitness.screen'> {
  const ride = ACTIVITIES.filter((a) => a.sport.type === 'Ride');
  const recent = ACTIVITIES.filter((a) => a.start > LIBRARY_END - 42 * DAY);
  const yearStart = Date.UTC(new Date(LIBRARY_END).getUTCFullYear(), 0, 1);
  const season = (from: number, to: number) => ({
    ...comparison(30),
    current: range(from, to),
    currentStats: stats(from, to),
  });
  return {
    ftpTrend: SUMMARY.ftpTrend,
    ftpTrendCoverage: 'loaded',
    runPaceTrend: emptyPace(),
    swimPaceTrend: emptyPace(),
    sportMix: {
      rides: recent.filter((a) => a.sport.type === 'Ride').length,
      runs: recent.filter((a) => a.sport.type === 'Run').length,
      swims: recent.filter((a) => a.sport.type === 'Swim').length,
      dominant: 'ride',
    },
    fitnessDays: 42,
    fatigueDays: 7,
    cyclingFtpSetting: 252,
    runningLthr: 168,
    decouplingSources: [],
    loadDots: ride.slice(-60).map((a) => ({
      activityId: a.id,
      name: a.name,
      sportType: a.sport.type,
      startDateLocal: isoLocal(a.start),
      movingTime: a.seconds,
      distance: a.distance,
      load: a.load,
    })),
    heatmap: LOADS.map((day) => {
      const inside = ACTIVITIES.filter((a) => isoLocal(a.start).startsWith(day.date));
      return {
        date: day.date,
        intensity: Math.min(4, Math.ceil(day.load / 40)),
        maxDuration: Math.max(0, ...inside.map((a) => a.seconds)),
        activityCount: inside.length,
      };
    }),
    calendarFirstDay: (LOADS[0] as (typeof LOADS)[number]).date,
    calendarOlderOwed: 0,
    months: months(),
    seasonYear: season(yearStart, LIBRARY_END + DAY),
    seasonMonths: [season(LIBRARY_END - 30 * DAY, LIBRARY_END + DAY)],
    comparisons: {
      week: comparison(7),
      month: comparison(30),
      threeMonths: comparison(90),
      sixMonths: comparison(180),
      year: comparison(365),
    },
  };
}

function powerCurve(): Result<'fitness.powerCurve'> {
  const secs = [1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
  const watts = [940, 820, 610, 480, 395, 340, 305, 280, 262, 252, 236];
  return {
    curve: {
      sport: 'Ride',
      secs,
      watts,
      wattsPerKg: watts.map((w) => w / 71.4),
      activityIds: null,
      wkgActivityIds: null,
      weight: 71.4,
      models: [{ kind: 'critical power', criticalPower: 248, wPrime: 21_500, ftp: 252, pMax: 940 }],
      activities: {},
      startDate: LOADS[0]!.date,
      endDate: lastDay.date,
      days: 365,
      fetchedAt: seconds(LIBRARY_END),
      source: 'demo',
    },
  };
}

function fitnessAnswers(): Record<string, unknown> {
  return {
    'fitness.screen': fitnessScreen(),
    'fitness.wellness': {
      days: LOADS.map((day, at) => ({
        date: day.date,
        ctl: day.fitness,
        atl: day.fatigue,
        rampRate: at > 7 ? day.fitness - (LOADS[at - 7] as (typeof LOADS)[number]).fitness : null,
        hrv: 60 + Math.sin(at / 5) * 7,
        restingHr: 47 + Math.cos(at / 6) * 2,
        weight: 71.4,
        sleepSecs: 7.2 * 3600,
        sleepScore: 80,
        soreness: null,
        fatigue: null,
        stress: null,
        mood: null,
        motivation: null,
        sportLoad: [],
        source: null,
      })),
      coverage: 'loaded',
    } satisfies Result<'fitness.wellness'>,
    'fitness.loads': {
      days: LOADS.map((day) => ({
        date: day.date,
        status: day.load > 0 ? 'complete' : 'rest',
        total: day.load > 0 ? day.load : null,
        activityCount: ACTIVITIES.filter((a) => isoLocal(a.start).startsWith(day.date)).length,
      })),
    } satisfies Result<'fitness.loads'>,
    'fitness.zones': {
      seconds: [41_000, 118_000, 52_000, 21_000, 8_000, 2_000, 600],
      shares: [17, 48, 21, 9, 3, 1, 1],
      names: [
        'Recovery',
        'Endurance',
        'Tempo',
        'Threshold',
        'VO2 max',
        'Anaerobic',
        'Neuromuscular',
      ],
    } satisfies Result<'fitness.zones'>,
    'fitness.powerCurve': powerCurve(),
    'fitness.paceCurve': { curve: null },
    'fitness.bestEfforts': { sports: [], climbing: [] } satisfies Result<'fitness.bestEfforts'>,
  };
}

// ── Insights ──

function insights(): Result<'insights.data'> {
  const efforts = (best: number) =>
    Array.from({ length: 6 }, (_, at) => ({
      value: best + (5 - at) * 4,
      date: seconds(LIBRARY_END - (5 - at) * 21 * DAY),
      activityId: null,
    }));
  const weeks: Result<'insights.data'>['weeklyTotals'] = [];
  for (let back = 25; back >= 0; back--) {
    const from = LIBRARY_END + DAY - (back + 1) * 7 * DAY;
    weeks.push({ start: seconds(from), stats: stats(from, from + 7 * DAY), partial: back === 0 });
  }
  const week = stats(LIBRARY_END - 6 * DAY, LIBRARY_END + DAY);
  const ranked = LOOPS.slice(0, 4).map((_, index) => ({
    sectionId: `section-${index}`,
    sectionName: `Climb ${index + 1}`,
    relevanceScore: 0.9 - index * 0.1,
    recencyScore: 0.7,
    improvementScore: 0.6,
    improvementChange: 0.04 - index * 0.02,
    improvementBasis: 'medianOfThree' as const,
    anomalyScore: 0.1,
    engagementScore: 0.5,
    traversalCount: 12 - index * 2,
    bestTimeSecs: 240 + index * 50,
    medianRecentSecs: 252 + index * 52,
    daysSinceLast: 3 + index * 6,
    trend: index % 2 === 0 ? 1 : -1,
    recentEfforts: efforts(240 + index * 50),
    bestActivityId: null,
  }));
  return {
    currentWeek: week,
    previousWeek: stats(LIBRARY_END - 13 * DAY, LIBRARY_END - 6 * DAY),
    chronicPeriod: stats(LIBRARY_END - 27 * DAY, LIBRARY_END + DAY),
    chronicWeekAverage: {
      count: 5,
      totalDuration: 27_000,
      totalDistance: 130_000,
      totalTss: 330,
    },
    weeklyTotals: weeks,
    ftpTrend: SUMMARY.ftpTrend,
    runPaceTrend: emptyPace(),
    swimPaceTrend: emptyPace(),
    recentPrs: [
      {
        sectionId: 'section-0',
        sectionName: 'Climb 1',
        bestTime: 238,
        daysAgo: 5,
        sportType: 'Ride',
        traversalCount: 12,
        standingCount: 1,
        percentileFaster: 92,
        previousBestTime: 246,
        previousBestDate: seconds(LIBRARY_END - 70 * DAY),
        deltaSeconds: -8,
        recentEfforts: efforts(238),
        encodedPolyline: encodeTrack(LOOPS[0]!.slice(10, 40)),
        bestActivityId: null,
      },
    ],
    sectionCount: LOOPS.length,
    sportTypes: ['Ride', 'Run'],
    rankedSections: [{ sportType: 'Ride', sections: ranked }],
    trendSections: [{ sportType: 'Ride', sections: ranked }],
    trendFasterCount: 2,
    trendSlowerCount: 2,
    routeInsights: [],
    routeRecordCount: 0,
    routeFasterCount: 0,
    routeSlowerCount: 0,
    efficiencyTrends: [],
    hasStrengthData: false,
    strengthSeries: null,
    form: { date: lastDay.date, ctl: lastDay.fitness, atl: lastDay.fatigue },
    weekOverWeek: {
      metric: 'tss',
      current: week.totalTss,
      previous: stats(LIBRARY_END - 13 * DAY, LIBRARY_END - 6 * DAY).totalTss,
      ratio: 1.8,
      comparedStart: seconds(LIBRARY_END - 13 * DAY),
    },
    weekAgainstChronic: null,
    hrvTrend: null,
    hrvWithheldSince: null,
    recentSectionChanges: [],
    stalePrOpportunities: [],
  };
}

/** The answers by method that are the same whatever the page asks. */
export function demoResults(): Record<string, unknown> {
  return {
    ...fitnessAnswers(),
    'insights.data': insights(),
    'feed.page': FEED,
    'feed.summary': SUMMARY,
    'feed.sparklines': SPARKS,
    'map.screen': MAP,
    'geo.routeLines': { text: routeLines() },
    'geo.sections': { text: sectionLines() },
    'heatmap.progress': { processed: ACTIVITIES.length, total: ACTIVITIES.length },
    'routes.screen': ROUTES,
    'settings.get': SETTINGS,
    'settings.profile': PROFILE,
    'status.sync': {
      state: 'idle',
      inFlight: 0,
      completed: 0,
      total: 0,
      stepItemsDone: 0,
      stepItemsTotal: 0,
      step: null,
      lastError: null,
      lastErrorReason: null,
      lastSuccessAt: isoLocal(LIBRARY_END),
      retryAtMs: null,
      tracks: null,
      heldBackInLastDownload: 0,
    },
    'status.coverage': {
      upstream: ACTIVITIES.length,
      fetched: ACTIVITIES.length,
      tracksUpstream: withTrack.length,
      tracksStored: withTrack.length,
    },
    'status.linkedDevices': {
      devices: [
        { id: '1', name: 'Studio laptop', createdAt: 1, lastSeenAt: null, connectedSince: 2 },
        { id: '2', name: 'Desk', createdAt: 1, lastSeenAt: null, connectedSince: null },
      ],
      thisBrowser: '1',
    },
    'status.cache': {
      streamRetentionDays: 180,
      streamStoreBytes: 48_000_000,
      activityYearCounts: [],
    },
    'status.backup': {
      homeLat: null,
      homeLng: null,
      radiusM: null,
      suggestion: null,
      notRestored: 0,
      namesNotRestored: 0,
      recordBackupRun: null,
    },
    'status.backgroundJobs': {
      runs: [],
      detectionAwaiting: null,
      cutoverOwed: false,
      streamDaysToFinish: null,
      backfillDayShare: null,
      garminPull: null,
      downloadsHeldUntilMs: null,
      downloadsHeldByUpstream: false,
      dailyLimit: null,
      passRecountRunning: false,
      stagedHistory: null,
    },
    'activity.intervals': { intervals: null },
  };
}

/** The answers that depend on which activity is asked, by method and then id. */
function byActivity(): Record<string, Record<string, unknown>> {
  const summaries: Record<string, unknown> = {};
  const streamsById: Record<string, unknown> = {};
  for (const a of newestFirst.slice(0, 60)) {
    const speed = a.distance / a.seconds;
    summaries[a.id] = {
      movingTime: a.seconds,
      elapsedTime: Math.round(a.seconds * 1.04),
      averageSpeed: speed,
      maxSpeed: speed * 1.6,
      averageCadence: a.sport.type === 'Run' ? 168 : a.sport.type === 'Ride' ? 86 : null,
      cadenceUnit: a.sport.type === 'Run' ? 'stepsPerMinute' : 'rpm',
    } satisfies Result<'activity.summary'>;
    if (a.route !== null) streamsById[a.id] = streams(a);
  }
  return { 'activity.summary': summaries, 'activity.streams': streamsById };
}

/** The newest ride, which has a track and a power stream, and which the activity route opens. */
export const SHOWN_ACTIVITY = (newestFirst.find((a) => a.sport.type === 'Ride') as DemoActivity).id;

/** The script of a phone holding the demo library. */
export function demoScript(
  base: Pick<Script, 'browserFingerprint' | 'phoneProof'> & { phoneFingerprint: string }
): Script {
  const results = demoResults();
  const perActivity = byActivity();
  return {
    browserFingerprint: base.browserFingerprint,
    phoneProof: base.phoneProof,
    invite: { fingerprint: base.phoneFingerprint },
    linked: { fingerprint: base.phoneFingerprint },
    methods: ['link.hello', 'heatmap.tile', ...Object.keys(results), ...Object.keys(perActivity)],
    results,
    byActivity: perActivity,
    anyTile: heatTilePng(),
    device: 'Sam’s phone',
    stats: [],
  };
}
