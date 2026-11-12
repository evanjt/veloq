// What the activity page draws from the phone's detail reads: the chart's
// series decoded from the engine's float buffers, and the lap and section rows
// of the right column. Pure, so a test drives it without a browser.

import type { ChartData } from './chart';
import type { Facts } from './ActivityPage';
import { clock, km } from './format';
import { bytesOf } from './link';
import type { Methods } from './schema';

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

/**
 * The slot of each read of the detail pane. A read asked in a slot withdraws
 * the one still outstanding there, so opening another ride cancels the first
 * ride's series, laps and screen data.
 */
export const DETAIL_SLOTS = {
  streams: 'detail.streams',
  laps: 'detail.laps',
  screen: 'detail.screen',
} as const;

/** The chart's series name for each stream the engine sends. */
const SERIES: [name: string, field: keyof Streams][] = [
  ['altitude', 'altitude'],
  ['heartrate', 'heartrate'],
  ['watts', 'watts'],
  ['cadence', 'cadence'],
  ['velocity', 'velocitySmooth'],
  ['grade', 'gradeSmooth'],
  ['temp', 'temp'],
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

const rides = (count: number) => `${count} ${count === 1 ? 'ride' : 'rides'}`;
const signed = (value: number) => `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(1)}`;

const PROVENANCE: Record<string, string> = {
  intervals: 'Synced from intervals.icu',
  garminOnPhone: 'Recorded on the phone from Garmin',
};

/**
 * The right column's rows: laps, the sections this ride rode with the stretch
 * of it each covers, its route, the time in each zone, its fitness impact,
 * where its data came from and the section changes that name it.
 */
export function factsOfDetail(
  laps: Laps | undefined,
  detail: DetailData | undefined,
  activityId?: string
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
    routes: (detail?.routeGroups ?? []).map((group) => ({
      id: group.groupId,
      name: group.customName ?? group.groupId,
      detail: rides(group.activityIds.length),
    })),
    intervals: (laps?.intervals?.intervals ?? []).map((lap) => ({
      name: lap.label ?? KIND[lap.kind] ?? 'Interval',
      time: clock(lap.movingTime) ?? '',
      distance: km(lap.distance) ?? '',
    })),
    zones,
    notes,
  };
}
