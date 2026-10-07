import { isPaceSport, isSwimmingActivity } from '@/shared/activity/activityUtils';
import { formatPace, formatSpeed, formatSwimPace } from '@/shared/format/format';
import type { ActivityType } from '@/types';

/** A speed in m/s in the unit the sport is plotted in: swim pace, pace or speed. */
export function formatSectionSpeed(
  speed: number,
  activityType: ActivityType,
  isMetric: boolean
): string {
  if (isSwimmingActivity(activityType)) return formatSwimPace(speed, isMetric);
  return isPaceSport(activityType) ? formatPace(speed, isMetric) : formatSpeed(speed, isMetric);
}
