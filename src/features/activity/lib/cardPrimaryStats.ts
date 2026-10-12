import { formatDistance, formatDuration, formatElevation } from '@/shared/format/format';
import type { Activity } from '@/types';

export interface CardPrimaryStats {
  /** Null when the activity covered no distance, so the slot is left out. */
  distance: string | null;
  duration: string;
  /** Null when the activity carries no climb, so the slot is left out. */
  elevation: string | null;
}

/**
 * The distance, time and climb an activity card and the detail hero print.
 * A zero distance is no distance. A zero climb is a measurement only when the
 * activity has an altitude stream: a flat ride climbed 0 m, a trainer ride or
 * a pool swim has no climb to print.
 */
export function cardPrimaryStats(
  activity: Pick<Activity, 'distance' | 'moving_time' | 'total_elevation_gain' | 'stream_types'>,
  isMetric: boolean
): CardPrimaryStats {
  const { distance, total_elevation_gain: gain } = activity;
  const hasAltitude = activity.stream_types?.includes('altitude') ?? false;
  return {
    distance: Number.isFinite(distance) && distance > 0 ? formatDistance(distance, isMetric) : null,
    duration: formatDuration(activity.moving_time),
    elevation:
      Number.isFinite(gain) && (gain > 0 || hasAltitude) ? formatElevation(gain, isMetric) : null,
  };
}
