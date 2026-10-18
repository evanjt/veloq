import type { ActivityRecord } from 'veloqrs';

type Fields = { [K in keyof ActivityRecord]?: ActivityRecord[K] | undefined };

/**
 * A stored activity as the engine types it for the detail screen. The figures
 * a record always carries default to what a manual entry stores; everything
 * else is absent unless the case names it, and a field given as `undefined`
 * is left absent.
 */
export function activityRecord(fields: Fields = {}): ActivityRecord {
  const record: Record<string, unknown> = {
    id: 'a1',
    isDetail: true,
    movingTime: 0,
    distance: 0,
    elevationGain: 0,
    hasWeather: false,
    streamTypes: [],
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) record[key] = value;
  }
  return record as ActivityRecord;
}
