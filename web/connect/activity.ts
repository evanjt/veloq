// What the activity page draws from the phone's detail reads: the chart's
// series decoded from the engine's float buffers, and the lap and section rows
// of the right column. Pure, so a test drives it without a browser.

import type { ChartData } from './chart';
import type { Detail } from './feedReads';
import type { Facts } from './pages/ActivityPage';
import { clock, elapsed, km, kmh } from './format';
import { bytesOf } from './link';
import type { FfiActivityRecord, Methods } from './schema';

export type Streams = Methods['activity.streams']['result'];
export type Laps = Methods['activity.intervals']['result'];
export type DetailData = Methods['activity.detail']['result'];

/**
 * The stream selection the phone's own detail charts ask for. The engine keys
 * a stored body on this exact list, so the link asks the same one.
 */
export const DETAIL_STREAM_TYPES = [
  'latlng',
  'altitude',
  'fixed_altitude',
  'heartrate',
  'watts',
  'cadence',
  'distance',
  'time',
  'velocity_smooth',
  'grade_smooth',
  'temp',
  'w_bal',
  'ga_velocity',
];

/** The chart's series name for each stream the engine sends. */
const SERIES: [name: string, field: keyof Streams][] = [
  ['altitude', 'altitude'],
  ['heartrate', 'heartrate'],
  ['watts', 'watts'],
  ['cadence', 'cadence'],
  ['velocity', 'velocitySmooth'],
  ['grade', 'gradeSmooth'],
  ['temp', 'temp'],
  ['wbal', 'wbal'],
  ['gap', 'gap'],
];

/** A run of 64-bit floats the engine wrote as its little-endian bytes. */
export function doublesOf(text: string): number[] {
  const bytes = bytesOf(text);
  const view = new DataView(bytes.buffer);
  return Array.from({ length: Math.floor(bytes.length / 8) }, (_, at) =>
    view.getFloat64(at * 8, true)
  );
}

/**
 * The chart's data from a stream answer, or null when the activity has no
 * time axis to draw against. A series of another length than the time axis is
 * dropped rather than drawn against the wrong samples.
 */
export function chartDataOf(streams: Streams | undefined): ChartData | null {
  if (!streams) return null;
  const time = doublesOf(streams.time);
  if (time.length === 0) return null;
  const distance = doublesOf(streams.distance);
  const series: Record<string, readonly number[]> = {};
  for (const [name, field] of SERIES) {
    const values = doublesOf(streams[field]);
    if (values.length === time.length) series[name] = values;
  }
  return {
    time,
    distance: distance.length === time.length ? distance : time.map(() => 0),
    series,
  };
}

const KIND: Record<string, string> = {
  work: 'Work',
  recovery: 'Recovery',
  rest: 'Rest',
  warmup: 'Warm-up',
  cooldown: 'Cool-down',
  activeRecovery: 'Active recovery',
  other: 'Interval',
};

type Portion = { from: number; to: number };

/** Whether a sample index lies within a section's portion of the ride. */
export const portionHolds = (portion: Portion | undefined, index: number | null) =>
  portion !== undefined && index !== null && index >= portion.from && index <= portion.to;

/** The rows whose portion meets the brushed samples; every row while no range is set, and a row with no portion only then. */
export function rowsInRange<T extends { portion?: Portion }>(
  rows: readonly T[],
  range: { from: number; to: number } | null
): T[] {
  if (!range) return [...rows];
  return rows.filter(
    (row) =>
      row.portion !== undefined && row.portion.from <= range.to && row.portion.to >= range.from
  );
}

/** A zone band as a value is placed against it: its zone and its upper edge, null for the open top band. */
type Band = { zone: number; max: number | null };

/**
 * The zone a value falls in. A band holds its lower edge and not its upper one,
 * so a value on an edge belongs to the band above it. A value at or above every
 * upper edge falls in the last band. No value, or no bands, places nothing.
 */
function bandOf(value: number | null | undefined, bands: readonly Band[]): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const band = bands.find((b) => b.max == null || value < b.max) ?? bands[bands.length - 1];
  return band?.zone;
}

const rowOf = (
  section: { id: string; name: string | null; distanceMeters: number },
  portion?: Portion
) => {
  const distance = km(section.distanceMeters);
  return {
    id: section.id,
    name: section.name ?? section.id,
    ...(distance ? { detail: distance } : {}),
    ...(portion ? { portion } : {}),
  };
};

const signedFigure = (value: number) => `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(1)}`;

/** The figure each row of the activity's grouped stats stands for. */
export type StatKey =
  | 'distance'
  | 'movingTime'
  | 'elapsedTime'
  | 'climbing'
  | 'averageSpeed'
  | 'topSpeed'
  | 'averageHr'
  | 'maxHr'
  | 'averagePower'
  | 'maxPower'
  | 'trainingLoad'
  | 'fitness'
  | 'fatigue'
  | 'form'
  | 'calories'
  | 'temperature'
  | 'wind'
  | 'newGround';

export type StatGroupKey =
  'time' | 'speed' | 'heartRate' | 'power' | 'load' | 'energy' | 'conditions' | 'newGround';

export type StatGroup = { key: StatGroupKey; rows: { key: StatKey; value: string }[] };

const whole = (value: number | null | undefined, unit: string) =>
  value == null || !Number.isFinite(value) ? null : `${Math.round(value)} ${unit}`;

/**
 * The stats beside the map, in groups: time and distance, speed, heart rate,
 * power, load with the fitness impact, energy, conditions and new ground. A
 * figure the activity does not carry is left out and so is a group with none;
 * nothing is drawn before the record has answered.
 */
export function statGroups(input: {
  record: FfiActivityRecord | null | undefined;
  summary: Detail | undefined;
  detail: DetailData | undefined;
}): StatGroup[] {
  const { record, summary, detail } = input;
  if (!record) return [];
  const impact = detail?.fitnessImpact;
  const ground = detail?.highlights?.newGround?.find((entry) => entry.activityId === record.id);
  const groups: [StatGroupKey, [StatKey, string | null | undefined][]][] = [
    [
      'time',
      [
        ['distance', km(record.distance || null)],
        ['movingTime', clock(summary?.movingTime)],
        ['elapsedTime', clock(summary?.elapsedTime)],
        ['climbing', record.elevationGain ? whole(record.elevationGain, 'm') : null],
      ],
    ],
    [
      'speed',
      [
        ['averageSpeed', kmh(summary?.averageSpeed)],
        ['topSpeed', kmh(summary?.maxSpeed)],
      ],
    ],
    [
      'heartRate',
      [
        ['averageHr', whole(record.avgHr, 'bpm')],
        ['maxHr', whole(record.maxHr, 'bpm')],
      ],
    ],
    [
      'power',
      [
        ['averagePower', whole(record.avgPower, 'W')],
        ['maxPower', whole(record.maxPower, 'W')],
      ],
    ],
    [
      'load',
      [
        [
          'trainingLoad',
          record.trainingLoad == null ? null : String(Math.round(record.trainingLoad)),
        ],
        ['fitness', impact ? signedFigure(impact.fitness) : null],
        ['fatigue', impact ? signedFigure(impact.fatigue) : null],
        ['form', impact ? signedFigure(impact.form) : null],
      ],
    ],
    ['energy', [['calories', whole(record.calories, 'kcal')]]],
    [
      'conditions',
      [
        ['temperature', whole(record.weatherTemp ?? record.sensorTemp, '°C')],
        ['wind', record.windSpeed == null ? null : kmh(record.windSpeed)],
      ],
    ],
    ['newGround', [['newGround', ground ? `${Math.round(ground.fraction * 100)} %` : null]]],
  ];
  return groups.flatMap(([key, rows]) => {
    const kept = rows.flatMap(([row, value]) => (value ? [{ key: row, value }] : []));
    return kept.length > 0 ? [{ key, rows: kept }] : [];
  });
}

export type RangeReadout = {
  /** Samples the range covers, ends included. */
  samples: number;
  seconds: number;
  metres: number;
  /** The mean of each series over the range, left out where it has no value there. */
  averages: Record<string, number>;
};

/**
 * What a brush over the charts covers: the span in time and distance and the
 * mean of every series over its samples. A range past the end is clamped to
 * it, a gap is left out of a mean, and null is returned for no range or one
 * with no sample in it.
 */
export function rangeReadout(
  data: ChartData,
  range: { from: number; to: number } | null
): RangeReadout | null {
  if (!range || data.time.length === 0) return null;
  const from = Math.max(0, Math.floor(range.from));
  const to = Math.min(data.time.length - 1, Math.floor(range.to));
  if (from > to) return null;
  const averages: Record<string, number> = {};
  for (const [key, values] of Object.entries(data.series)) {
    let sum = 0;
    let count = 0;
    for (let at = from; at <= to; at++) {
      const value = values[at];
      if (value !== undefined && Number.isFinite(value)) {
        sum += value;
        count++;
      }
    }
    if (count > 0) averages[key] = sum / count;
  }
  return {
    samples: to - from + 1,
    seconds: (data.time[to] ?? 0) - (data.time[from] ?? 0),
    metres: (data.distance[to] ?? 0) - (data.distance[from] ?? 0),
    averages,
  };
}

const xmlEscape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A GPX 1.1 file holding one track: a point per position in order, with its
 * elevation where the stream has one. The activity's own clock is not written,
 * because the stored start has no zone.
 */
export function gpxOf(
  name: string,
  positions: readonly [number, number][],
  elevations: readonly number[] = []
): string {
  const points = positions.map(([lng, lat], at) => {
    const elevation = elevations[at];
    const ele =
      elevation !== undefined && Number.isFinite(elevation)
        ? `<ele>${Math.round(elevation * 10) / 10}</ele>`
        : '';
    return `<trkpt lat="${lat}" lon="${lng}">${ele}</trkpt>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Veloq" xmlns="http://www.topografix.com/GPX/1/1">',
    `<trk><name>${xmlEscape(name)}</name><trkseg>${points.join('')}</trkseg></trk>`,
    '</gpx>',
    '',
  ].join('\n');
}

const rides = (count: number) => `${count} ${count === 1 ? 'ride' : 'rides'}`;
const signed = (value: number) => `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(1)}`;

const PROVENANCE: Record<string, string> = {
  intervals: 'Synced from intervals.icu',
  garminOnPhone: 'Recorded on the phone from Garmin',
};

/**
 * One row per pass over a section, in the order the track meets them: the lap
 * time, the podium place, whether it is the record, and the section's history
 * of times with this pass marked.
 */
function passesOf(
  detail: DetailData | undefined,
  activityId?: string
): NonNullable<Facts['passes']> {
  return [...(detail?.encounters ?? [])]
    .sort((a, b) => a.startIndex - b.startIndex)
    .map((pass) => {
      const at = activityId ? pass.historyActivityIds.indexOf(activityId) : -1;
      return {
        key: `${pass.sectionId}:${pass.direction}:${pass.startIndex}`,
        id: pass.sectionId,
        name: pass.sectionName || pass.sectionId,
        lapTime: elapsed(pass.lapTime * 1000),
        rank: pass.rank,
        pr: pass.isPr,
        history: pass.historyTimes,
        current: at >= 0 ? at : pass.historyTimes.length - 1,
      };
    });
}

/** Where this activity stands on each route it belongs to: the best and mean times and the gap from this one's moving time to the best. */
function standingOf(
  detail: DetailData | undefined,
  movingTime?: number | null
): NonNullable<Facts['standing']> {
  return (detail?.routeGroups ?? []).map((group) => ({
    id: group.groupId,
    name: group.customName ?? group.groupId,
    rides: rides(group.activityIds.length),
    best: group.bestTime == null ? '' : elapsed(group.bestTime * 1000),
    average: group.avgTime == null ? '' : elapsed(group.avgTime * 1000),
    gap:
      group.bestTime == null || movingTime == null
        ? ''
        : `${movingTime - group.bestTime < 0 ? '-' : '+'}${elapsed(Math.abs(movingTime - group.bestTime) * 1000)}`,
    bestActivityId: group.bestActivityId,
  }));
}

/**
 * The right column's rows: laps, the sections this ride rode with the stretch
 * of it each covers, its route, the time in each zone, its fitness impact,
 * where its data came from and the section changes that name it.
 */
export function factsOfDetail(
  laps: Laps | undefined,
  detail: DetailData | undefined,
  activityId?: string,
  movingTime?: number | null
): Facts {
  const sections = new Map<string, NonNullable<Facts['sections']>[number]>();
  for (const section of detail?.matchedSections ?? []) {
    sections.set(section.id, rowOf(section));
  }
  for (const section of detail?.customSections ?? []) {
    if (sections.has(section.id)) continue;
    const mine = section.activityPortions?.find((p) => p.activityId === activityId);
    sections.set(
      section.id,
      rowOf(section, mine ? { from: mine.startIndex, to: mine.endIndex } : undefined)
    );
  }
  const powerBands: Band[] = (detail?.powerZones ?? []).map((band) => ({
    zone: band.zone,
    max: band.maxWatts,
  }));
  const heartBands: Band[] = (detail?.hrZones ?? []).map((band) => ({
    zone: band.zone,
    max: band.maxBpm,
  }));
  const zones: NonNullable<Facts['zones']> = [];
  if (detail?.hrZones?.length) {
    zones.push({
      label: 'Heart rate zones',
      rows: detail.hrZones.map((band) => ({
        name: `Z${band.zone} ${band.minBpm}–${band.maxBpm} bpm`,
        share: band.share,
      })),
    });
  }
  if (detail?.powerZones?.length) {
    zones.push({
      label: 'Power zones',
      rows: detail.powerZones.map((band) => ({
        name: `Z${band.zone} ${band.minWatts}${band.maxWatts == null ? '+' : `–${band.maxWatts}`} W`,
        share: band.share,
      })),
    });
  }
  const notes: NonNullable<Facts['notes']> = [];
  const impact = detail?.fitnessImpact;
  if (impact) {
    notes.push({
      label: 'Fitness impact',
      value: `${signed(impact.fitness)} fitness, ${signed(impact.fatigue)} fatigue, ${signed(impact.form)} form`,
    });
  }
  if (detail?.provenance) {
    notes.push({
      label: 'Source',
      value: PROVENANCE[detail.provenance] ?? detail.provenance,
    });
  }
  if (detail?.ledgerChanges?.length) {
    notes.push({ label: 'Section changes', value: String(detail.ledgerChanges.length) });
  }
  return {
    sections: [...sections.values()],
    passes: passesOf(detail, activityId),
    standing: standingOf(detail, movingTime),
    routes: (detail?.routeGroups ?? []).map((group) => ({
      id: group.groupId,
      name: group.customName ?? group.groupId,
      detail: rides(group.activityIds.length),
    })),
    intervals: (laps?.intervals?.intervals ?? []).map((lap) => {
      // The mean power places a lap when the ride has power zones to place it in,
      // and the mean heart rate places it otherwise.
      const band = bandOf(lap.averageWatts, powerBands) ?? bandOf(lap.averageHeartrate, heartBands);
      return {
        name: lap.label ?? KIND[lap.kind] ?? 'Interval',
        time: clock(lap.movingTime) ?? '',
        distance: km(lap.distance) ?? '',
        portion: { from: lap.startIndex, to: lap.endIndex },
        ...(band === undefined ? {} : { band }),
      };
    }),
    zones,
    notes,
  };
}
