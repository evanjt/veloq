import type { DataFieldType } from '@/types';

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

/** The tiles each recording mode shows until the athlete chooses otherwise. */
export const DEFAULT_DATA_FIELDS: Readonly<Record<string, DataFieldType[]>> = {
  gps: ['speed', 'distance', 'heartrate', 'power'],
  indoor: ['heartrate', 'power', 'cadence', 'timer'],
  manual: ['timer', 'distance'],
};

/** The tiles a mode shows: the stored layout, else that mode's default. */
export function fieldsForMode(
  dataFields: Readonly<Record<string, DataFieldType[]>>,
  mode: string
): DataFieldType[] {
  return dataFields[mode] ?? DEFAULT_DATA_FIELDS[mode] ?? [];
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
