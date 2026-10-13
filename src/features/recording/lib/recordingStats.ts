import type { TFunction } from 'i18next';

import type { ActivityType } from '@/types';
import { isPaceSport, isSwimmingActivity } from '@/shared/activity/activityUtils';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPower,
  formatSportSpeed,
} from '@/shared/format/format';

/** What a recording's stats are built from, on review and once saved. */
export interface RecordingStatsInput {
  activityType: ActivityType;
  movingSeconds: number;
  /** Null when the elapsed time was not kept, as on a saved row. */
  elapsedSeconds: number | null;
  distanceMeters: number;
  elevationGain: number | null | undefined;
  avgHeartrate: number | null | undefined;
  avgPower: number | null | undefined;
}

export type RecordingStatKey =
  | 'movingTime'
  | 'elapsedTime'
  | 'distance'
  | 'elevationGain'
  | 'avgSpeed'
  | 'avgHeartrate'
  | 'avgPower';

export interface RecordingStat {
  key: RecordingStatKey;
  label: string;
  value: string;
}

/**
 * The stats a recording shows, each named by what it measures. Moving time
 * always shows; elapsed time only when pauses made it longer; distance, gain
 * and the averages only when the recording carries them.
 */
export function recordingStats(
  input: RecordingStatsInput,
  isMetric: boolean,
  t: TFunction
): RecordingStat[] {
  const stats: RecordingStat[] = [
    {
      key: 'movingTime',
      label: t('recording.fields.movingTime'),
      value: formatDuration(input.movingSeconds),
    },
  ];
  // Under a second apart is the same clock read at two moments, not a pause.
  if (input.elapsedSeconds != null && input.elapsedSeconds - input.movingSeconds >= 1) {
    stats.push({
      key: 'elapsedTime',
      label: t('recording.fields.elapsedTime'),
      value: formatDuration(input.elapsedSeconds),
    });
  }
  if (input.distanceMeters > 0) {
    stats.push({
      key: 'distance',
      label: t('recording.fields.distance'),
      value: formatDistance(input.distanceMeters, isMetric),
    });
  }
  if (input.elevationGain != null && input.elevationGain > 0) {
    stats.push({
      key: 'elevationGain',
      label: t('recording.fields.elevationGain'),
      value: formatElevation(input.elevationGain, isMetric),
    });
  }
  if (input.distanceMeters > 0 && input.movingSeconds > 0) {
    const pace = isPaceSport(input.activityType) || isSwimmingActivity(input.activityType);
    stats.push({
      key: 'avgSpeed',
      label: t(pace ? 'recording.fields.avgPace' : 'recording.fields.avgSpeed'),
      value: formatSportSpeed(
        input.distanceMeters / input.movingSeconds,
        input.activityType,
        isMetric
      ),
    });
  }
  if (input.avgHeartrate != null && input.avgHeartrate > 0) {
    stats.push({
      key: 'avgHeartrate',
      label: t('recording.avgHrLabel'),
      value: formatHeartRate(input.avgHeartrate),
    });
  }
  if (input.avgPower != null && input.avgPower > 0) {
    stats.push({
      key: 'avgPower',
      label: t('recording.fields.avgPower'),
      value: formatPower(input.avgPower),
    });
  }
  return stats;
}
