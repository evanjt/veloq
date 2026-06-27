import type { ActivityInterval, IntervalsDTO, ActivityIntervalGroup } from '@/types';
import { createActivitySeededRandom } from '@/data/demo/random';

import { getActivity } from './activities';

export function getActivityIntervals(id: string): IntervalsDTO {
  const activity = getActivity(id);
  if (!activity) return { icu_intervals: [], icu_groups: [] };

  const random = createActivitySeededRandom(id + '-intervals');
  const isRide = activity.type === 'Ride' || activity.type === 'VirtualRide';
  const isRun = activity.type === 'Run';

  // Only generate intervals for cycling and running
  if (!isRide && !isRun) return { icu_intervals: [], icu_groups: [] };

  const intervals: ActivityInterval[] = [];
  const splitDist = isRide ? 5000 : 1000; // 5km splits for rides, 1km for runs
  const totalDist = activity.distance;
  const numSplits = Math.max(2, Math.min(12, Math.floor(totalDist / splitDist)));
  const avgSpeed = activity.average_speed || 5;
  let currentIndex = 0;

  for (let i = 0; i < numSplits; i++) {
    const isWork = i % 2 === 0;
    const segDist = splitDist * (0.9 + random() * 0.2);
    const segTime = Math.round(segDist / avgSpeed);
    const endIndex = currentIndex + Math.round(segTime / 5); // ~5 sec per sample

    const interval: ActivityInterval = {
      id: i + 1,
      type: isWork ? 'WORK' : 'RECOVERY',
      label: isWork ? `Interval ${Math.ceil((i + 1) / 2)}` : null,
      start_index: currentIndex,
      end_index: endIndex,
      distance: Math.round(segDist),
      moving_time: segTime,
      elapsed_time: Math.round(segTime * 1.02),
      average_speed: avgSpeed * (isWork ? 1.05 + random() * 0.1 : 0.85 + random() * 0.1),
      average_heartrate: activity.average_heartrate
        ? Math.round(
            activity.average_heartrate * (isWork ? 1.05 + random() * 0.05 : 0.88 + random() * 0.05)
          )
        : undefined,
      average_watts:
        isRide && activity.average_watts
          ? Math.round(
              activity.average_watts * (isWork ? 1.1 + random() * 0.1 : 0.7 + random() * 0.1)
            )
          : undefined,
      weighted_average_watts:
        isRide && activity.weighted_average_watts
          ? Math.round(
              activity.weighted_average_watts *
                (isWork ? 1.08 + random() * 0.08 : 0.72 + random() * 0.08)
            )
          : undefined,
      average_cadence: activity.average_cadence
        ? Math.round(activity.average_cadence + (random() - 0.5) * 6)
        : undefined,
      max_heartrate: activity.average_heartrate
        ? Math.round(activity.average_heartrate * (isWork ? 1.15 : 1.0))
        : undefined,
      max_watts:
        isRide && activity.average_watts
          ? Math.round(activity.average_watts * (isWork ? 1.4 : 1.0))
          : undefined,
      total_elevation_gain: Math.round(
        (activity.total_elevation_gain / numSplits) * (0.8 + random() * 0.4)
      ),
    };

    intervals.push(interval);
    currentIndex = endIndex;
  }

  // Build a summary group
  const workIntervals = intervals.filter((i) => i.type === 'WORK');
  const group: ActivityIntervalGroup = {
    id: 'work',
    count: workIntervals.length,
    distance: workIntervals.reduce((s, i) => s + i.distance, 0),
    moving_time: workIntervals.reduce((s, i) => s + i.moving_time, 0),
    elapsed_time: workIntervals.reduce((s, i) => s + i.elapsed_time, 0),
    average_speed: workIntervals.reduce((s, i) => s + i.average_speed, 0) / workIntervals.length,
    average_heartrate: workIntervals[0]?.average_heartrate
      ? workIntervals.reduce((s, i) => s + (i.average_heartrate || 0), 0) / workIntervals.length
      : undefined,
    average_watts: workIntervals[0]?.average_watts
      ? workIntervals.reduce((s, i) => s + (i.average_watts || 0), 0) / workIntervals.length
      : undefined,
    average_cadence: workIntervals[0]?.average_cadence
      ? workIntervals.reduce((s, i) => s + (i.average_cadence || 0), 0) / workIntervals.length
      : undefined,
    max_heartrate: workIntervals[0]?.max_heartrate
      ? Math.max(...workIntervals.map((i) => i.max_heartrate || 0))
      : undefined,
    max_watts: workIntervals[0]?.max_watts
      ? Math.max(...workIntervals.map((i) => i.max_watts || 0))
      : undefined,
    total_elevation_gain: workIntervals.reduce((s, i) => s + (i.total_elevation_gain || 0), 0),
  };

  return { icu_intervals: intervals, icu_groups: [group] };
}
