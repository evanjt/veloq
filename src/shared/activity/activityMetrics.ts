/**
 * @fileoverview Activity metrics utilities for route engine
 *
 * Helper functions for converting Activity objects to the format
 * expected by the Rust route engine.
 */

import type { Activity } from '@/types';
import { type ActivityMetrics } from 'veloqrs';
import { startDateLocalToEpochSeconds } from '@/shared/time/startDate';

/** Z1 to Z7 only: the API also lists Sweet Spot, which overlaps them. */
export function powerZoneEntries<T extends { id: string }>(zoneTimes: readonly T[]): T[] {
  return zoneTimes.filter((z) => /^Z\d+$/.test(z.id));
}

/** The engine stores these as unsigned 16-bit integers and rounds them, so the row written here is the one the sync writes. */
function wholeNumber(value: number): number {
  // The API sends null for a reading it does not have, whatever the type says,
  // and rounding that would record a reading of 0.
  return value == null ? value : Math.max(0, Math.round(value));
}

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
  const powerZoneTimes = activity.icu_zone_times
    ? powerZoneEntries(activity.icu_zone_times).map((z) => z.secs)
    : undefined;
  const hrZoneTimes = activity.icu_hr_zone_times ?? undefined;

  return {
    activityId: activity.id,
    name: activity.name,
    date: startDateLocalToEpochSeconds(activity.start_date_local) ?? 0,
    distance: activity.distance ?? 0,
    movingTime: activity.moving_time ?? 0,
    elapsedTime: activity.elapsed_time ?? 0,
    elevationGain: activity.total_elevation_gain || 0,
    sportType: activity.type || 'Ride',
    // An absent field is left out, not set to undefined, so the record is the
    // shape the engine declares.
    ...(activity.average_heartrate !== undefined && {
      avgHr: wholeNumber(activity.average_heartrate),
    }),
    ...(activity.icu_average_watts !== undefined && {
      avgPower: wholeNumber(activity.icu_average_watts),
    }),
    ...(activity.icu_training_load !== undefined && { trainingLoad: activity.icu_training_load }),
    ...(activity.icu_ftp !== undefined && { ftp: wholeNumber(activity.icu_ftp) }),
    ...(powerZoneTimes !== undefined && { powerZoneTimes }),
    ...(hrZoneTimes !== undefined && { hrZoneTimes }),
  };
}
