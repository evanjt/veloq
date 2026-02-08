/**
 * @fileoverview Activity metrics utilities for route engine
 *
 * Helper functions for converting Activity objects to the format
 * expected by the Rust route engine.
 */

import type { Activity } from '@/types';
import { type ActivityMetrics } from 'veloqrs';

/**
 * Convert Activity to ActivityMetrics for Rust engine.
 *
 * Used by the route engine to calculate performance metrics
 * and power curves for route comparisons.
 *
 * @param activity - Activity to convert
 * @returns ActivityMetrics object for Rust engine
 */
export function toActivityMetrics(activity: Activity): ActivityMetrics {
  // Serialize zone times as JSON arrays for SQL aggregation in Rust
  const powerZoneTimes = activity.icu_zone_times
    ? JSON.stringify(activity.icu_zone_times.map((z) => z.secs))
    : undefined;
  const hrZoneTimes = activity.icu_hr_zone_times
    ? JSON.stringify(activity.icu_hr_zone_times)
    : undefined;

  return {
    activityId: activity.id,
    name: activity.name,
    date: BigInt(Math.floor(new Date(activity.start_date_local).getTime() / 1000)),
    distance: activity.distance,
    movingTime: activity.moving_time,
    elapsedTime: activity.elapsed_time,
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
