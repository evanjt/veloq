import type { ActivityType } from '@/types';
import { formatSportSpeed } from '@/shared/format/format';

export function formatRecordingSpeed(
  activityType: ActivityType | null | undefined,
  metresPerSecond: number,
  isMetric: boolean
): string {
  return formatSportSpeed(metresPerSecond, activityType ?? 'Ride', isMetric);
}
