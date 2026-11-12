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

const rowOf = (section: { id: string; name: string | null; distanceMeters: number }) => {
  const distance = km(section.distanceMeters);
  return {
    id: section.id,
    name: section.name ?? section.id,
    ...(distance ? { detail: distance } : {}),
  };
};

/** The lap and section rows of the right column. */
export function factsOfDetail(laps: Laps | undefined, detail: DetailData | undefined): Facts {
  const sections = new Map<string, NonNullable<Facts['sections']>[number]>();
  for (const section of detail?.matchedSections ?? []) {
    sections.set(section.id, rowOf(section));
  }
  for (const section of detail?.customSections ?? []) {
    if (sections.has(section.id)) continue;
    sections.set(section.id, rowOf(section));
  }
  return {
    sections: [...sections.values()],
    intervals: (laps?.intervals?.intervals ?? []).map((lap) => ({
      name: lap.label ?? KIND[lap.kind] ?? 'Interval',
      time: clock(lap.movingTime) ?? '',
      distance: km(lap.distance) ?? '',
    })),
  };
}
