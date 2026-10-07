import { isCyclingActivity } from '@/shared/activity/activityUtils';
import type { Activity } from '@/types';

/** The ride the Fitness card reports, and the value intervals.icu stored for it. */
export interface DecouplingSource {
  activityId: string;
  name: string;
  /** `start_date_local` as stored. */
  date: string;
  /** Percentage, as intervals.icu computed it. */
  decoupling: number;
}

// The decoupling of a ride shorter than this is not offered on the Fitness card.
const MIN_MOVING_SECONDS = 30 * 60;

/**
 * intervals.icu's stored decoupling, or null when the body carries no finite
 * number. The same field on an interval arrives as the string `-Infinity` when
 * a half has no power, so a value is never formatted before it is read here.
 */
export function storedDecoupling(activity: { decoupling?: unknown }): number | null {
  const value = activity.decoupling;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The newest ride of half an hour or more with power, heart rate and a stored
 * decoupling. `activities` is newest first, as the stored read returns it.
 */
export function decouplingSource(activities: Activity[] | undefined): DecouplingSource | null {
  for (const activity of activities ?? []) {
    if (!isCyclingActivity(activity.type)) continue;
    if (!activity.icu_average_watts || !activity.average_heartrate) continue;
    if (activity.moving_time < MIN_MOVING_SECONDS) continue;
    const decoupling = storedDecoupling(activity);
    if (decoupling === null) continue;
    return {
      activityId: activity.id,
      name: activity.name,
      date: activity.start_date_local,
      decoupling,
    };
  }
  return null;
}
