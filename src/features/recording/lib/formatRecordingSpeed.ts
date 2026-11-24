import { recordings } from 'veloqrs';

import type { ActivityType } from '@/types';
import { readsAsPace } from '@/shared/activity/activityUtils';
import { formatSpeed } from '@/shared/format/format';

/**
 * A live pace as the engine reads it: per 100 m or 100 yd for a swim, per
 * kilometre or mile for every other sport, or the engine's no-pace text.
 * `activityType` is null where the recording has no sport.
 */
export function formatRecordingPace(
  activityType: ActivityType | null | undefined,
  metresPerSecond: number,
  isMetric: boolean
): string {
  return recordings.livePace(metresPerSecond, activityType ?? undefined, isMetric).text;
}

/**
 * A live speed the way its sport reads it: the engine's pace for a pace sport
 * or a swim, and speed otherwise. A recording with no sport reads as a ride.
 */
export function formatRecordingSpeed(
  activityType: ActivityType | null | undefined,
  metresPerSecond: number,
  isMetric: boolean
): string {
  const sport = activityType ?? 'Ride';
  return readsAsPace(sport)
    ? formatRecordingPace(sport, metresPerSecond, isMetric)
    : formatSpeed(metresPerSecond, isMetric);
}
