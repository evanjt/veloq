/**
 * @fileoverview Activity metrics utilities for route engine
 *
 * Helper functions for converting Activity objects to the format
 * expected by the Rust route engine.
 */

import type { Activity } from '@/types';
import { type ActivityMetrics } from 'veloqrs';
import { startDateLocalToEpochSeconds } from '@/shared/time/startDate';

/**
 * Convert Activity to ActivityMetrics for Rust engine.
 *
 * Used by the route engine to calculate performance metrics
 * and power curves for route comparisons.
 *
 * @param activity - Activity to convert
 * @returns ActivityMetrics object for Rust engine
 */
/**
 * Whether an activity is worth a row in `activity_metrics`.
 *
 * The date is the only hard requirement: it is what every read keys on, and an
 * activity with no local start date has none. Duration is not a requirement.
 * A strength session recorded with zero moving time still has its FIT
 * downloaded and its sets written, and every strength aggregate INNER JOINs
 * this table, so skipping the row leaves those sets with no read path.
 */
export function hasMetricsRow(activity: Activity): boolean {
  return Boolean(activity.start_date_local);
}

export function toActivityMetrics(activity: Activity): ActivityMetrics {
  const powerZoneTimes = activity.icu_zone_times
    ? activity.icu_zone_times.map((z) => z.secs)
    : undefined;
  const hrZoneTimes = activity.icu_hr_zone_times ?? undefined;

  return {
    activityId: activity.id,
    name: activity.name,
    date: BigInt(startDateLocalToEpochSeconds(activity.start_date_local) ?? 0),
    distance: activity.distance ?? 0,
    movingTime: activity.moving_time ?? 0,
    elapsedTime: activity.elapsed_time ?? 0,
    elevationGain: activity.total_elevation_gain || 0,
    avgHr: activity.average_heartrate,
    avgPower: activity.average_watts,
    sportType: activity.type || 'Ride',
    trainingLoad: activity.icu_training_load,
    ftp: activity.icu_ftp,
    powerZoneTimes,
    hrZoneTimes,
  };
}
