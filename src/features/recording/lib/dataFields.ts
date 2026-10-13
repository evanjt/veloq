import { isPaceSport, measuresPower } from '@/shared/activity/activityUtils';
import type { ActivityType, DataFieldType, RecordingMode } from '@/types';

import { getRecordingMode } from './recordingModes';

/** Every field a data tile can show, in the order the field picker lists them. */
export const ALL_DATA_FIELDS: DataFieldType[] = [
  'speed',
  'avgSpeed',
  'pace',
  'avgPace',
  'distance',
  'heartrate',
  'power',
  'cadence',
  'elevation',
  'elevationGain',
  'calories',
  'timer',
  'movingTime',
  'lapTime',
  'lapDistance',
];

/**
 * The most tiles a mode shows. Tiles are half width, so an even cap fills whole
 * rows, and three rows leave the controls below them on a phone.
 */
export const MAX_DATA_FIELDS = 6;

/** The tiles a recording of this sport shows until the athlete chooses otherwise. */
export function defaultDataFields(sport: ActivityType): DataFieldType[] {
  const mode = getRecordingMode(sport);
  if (mode === 'manual') return ['timer', 'distance'];
  const effort: DataFieldType = measuresPower(sport)
    ? 'power'
    : isPaceSport(sport)
      ? 'pace'
      : 'calories';
  if (mode === 'indoor') return ['heartrate', effort, 'cadence', 'timer'];
  if (isPaceSport(sport)) return ['pace', 'distance', 'heartrate', 'movingTime'];
  return ['speed', 'distance', 'heartrate', measuresPower(sport) ? 'power' : 'movingTime'];
}

/** The sport whose defaults a mode shows where no sport is in hand, as in settings. */
const MODE_DEFAULT_SPORT: Readonly<Record<RecordingMode, ActivityType>> = {
  gps: 'Ride',
  indoor: 'VirtualRide',
  manual: 'Workout',
};

/**
 * The layout every mode stored before defaults followed the sport. A stored
 * layout equal to one of these was never chosen, so it gives way to the sport.
 */
const UNCHOSEN_LAYOUTS: Readonly<Record<string, readonly DataFieldType[]>> = {
  gps: ['speed', 'distance', 'heartrate', 'power'],
  indoor: ['heartrate', 'power', 'cadence', 'timer'],
  manual: ['timer', 'distance'],
};

/** The stored layouts with every unchosen one dropped, so the sport default shows instead. */
export function chosenLayouts(
  dataFields: Readonly<Record<string, DataFieldType[]>>
): Record<string, DataFieldType[]> {
  const chosen: Record<string, DataFieldType[]> = {};
  for (const [mode, fields] of Object.entries(dataFields)) {
    const unchosen = UNCHOSEN_LAYOUTS[mode];
    const isUnchosen =
      unchosen !== undefined &&
      Array.isArray(fields) &&
      fields.length === unchosen.length &&
      fields.every((f, i) => f === unchosen[i]);
    if (!isUnchosen) chosen[mode] = fields;
  }
  return chosen;
}

/** A layout trimmed to the cap. */
export function capFields(fields: DataFieldType[]): DataFieldType[] {
  return fields.length > MAX_DATA_FIELDS ? fields.slice(0, MAX_DATA_FIELDS) : fields;
}

/**
 * The tiles a mode shows: the stored layout, else the sport's default, or the
 * mode's own default where no sport is given.
 */
export function fieldsForMode(
  dataFields: Readonly<Record<string, DataFieldType[]>>,
  mode: string,
  sport?: ActivityType | null
): DataFieldType[] {
  const stored = dataFields[mode];
  if (stored) return capFields(stored);
  if (sport) return defaultDataFields(sport);
  return Object.hasOwn(MODE_DEFAULT_SPORT, mode)
    ? defaultDataFields(MODE_DEFAULT_SPORT[mode as RecordingMode])
    : [];
}

/**
 * The layout with `field` in tile `index`. A field already shown in another tile
 * swaps places with the one it displaces, so no field appears twice. Returns the
 * same array when nothing changes or the tile is outside the layout.
 */
export function placeFieldInSlot(
  fields: DataFieldType[],
  index: number,
  field: DataFieldType
): DataFieldType[] {
  if (!Number.isInteger(index) || index < 0) return fields;
  const displaced = fields[index];
  if (displaced === undefined || displaced === field) return fields;
  const next = [...fields];
  const existing = next.indexOf(field);
  if (existing >= 0) next[existing] = displaced;
  next[index] = field;
  return next;
}
