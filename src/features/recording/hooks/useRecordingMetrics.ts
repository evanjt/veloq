import { useMemo } from 'react';

import { freshValue, useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useClock } from '@/features/recording/hooks/useTimer';
import { useAuthStore } from '@/shared/app/AuthStore';
import { pausedSecondsBetween } from '@/features/recording/lib/pausedTime';

// MET values for calorie estimation
const MET_VALUES: Record<string, number> = {
  cycling: 8,
  running: 10,
  walking: 4,
  swimming: 7,
  default: 6,
};

const DEFAULT_WEIGHT_KG = 70;

function getMet(activityType: string): number {
  const lower = activityType.toLowerCase();
  if (lower.includes('ride') || lower.includes('cycling') || lower.includes('bike')) {
    return MET_VALUES.cycling;
  }
  if (lower.includes('run') || lower.includes('treadmill')) {
    return MET_VALUES.running;
  }
  if (lower.includes('walk') || lower.includes('hike')) {
    return MET_VALUES.walking;
  }
  if (lower.includes('swim')) {
    return MET_VALUES.swimming;
  }
  return MET_VALUES.default;
}

export function useRecordingMetrics(): {
  speed: number;
  avgSpeed: number;
  distance: number;
  heartrate: number;
  power: number;
  cadence: number;
  /** The last valid altitude reading, null before any fix has carried one. */
  elevation: number | null;
  elevationGain: number;
  calories: number;
  lapDistance: number;
  lapTime: number;
} {
  const streams = useRecordingStore((s) => s.streams);
  const latestSensor = useRecordingStore((s) => s.latestSensor);

  // A sensor going quiet is the absence of an update, so nothing in the store
  // marks it. The clock is what turns a held sample stale, and it has to be a
  // value the memo reads rather than a `Date.now()` in the render body.
  const nowMs = useClock();
  const totals = useRecordingStore((s) => s.totals);
  const laps = useRecordingStore((s) => s.laps);
  const activityType = useRecordingStore((s) => s.activityType);
  const pauseIntervals = useRecordingStore((s) => s.pauseIntervals);
  const startTime = useRecordingStore((s) => s.startTime);
  const openPauseStart = useRecordingStore((s) => (s.status === 'paused' ? s._pauseStart : null));
  const athleteWeight = useAuthStore((s) => {
    // Weight comes from the intervals.icu API but is not typed on Athlete
    const a = s.athlete as Record<string, unknown> | null;
    return typeof a?.weight === 'number' ? a.weight : undefined;
  });

  return useMemo(() => {
    // The tiles read the sensors, not the recorded streams. A stream starts at
    // the first point, which outdoors waits for a GPS fix, so a connected
    // sensor would otherwise read 0 through the wait.
    const liveHeartrate = freshValue(latestSensor.heartrate, nowMs);
    const livePower = freshValue(latestSensor.power, nowMs);
    const liveCadence = freshValue(latestSensor.cadence, nowMs);

    const len = streams.time.length;
    if (len === 0) {
      return {
        speed: 0,
        avgSpeed: 0,
        distance: 0,
        heartrate: liveHeartrate,
        power: livePower,
        cadence: liveCadence,
        elevation: null,
        elevationGain: 0,
        calories: 0,
        lapDistance: 0,
        lapTime: 0,
      };
    }

    // Current values (last element in each stream)
    const lastIdx = len - 1;
    const speed = streams.speed[lastIdx] ?? 0;
    const distance = streams.distance[lastIdx] ?? 0;
    const heartrate = liveHeartrate;
    const power = livePower;
    const cadence = liveCadence;
    const elevation = totals.lastAltitude;

    // Stream times are wall clock, so the pauses come back out, the review's
    // rule. A pause still open began at the first stationary fix, whose samples
    // are already in the streams, so its overlap with the window comes out too.
    const elapsedSeconds = streams.time[lastIdx] ?? 0;
    const pauses =
      openPauseStart && startTime
        ? [...pauseIntervals, { start: (openPauseStart - startTime) / 1000, end: Infinity }]
        : pauseIntervals;
    const movingSeconds = Math.max(
      0,
      elapsedSeconds - pausedSecondsBetween(pauses, 0, elapsedSeconds)
    );
    const avgSpeed = movingSeconds > 0 ? distance / movingSeconds : 0;

    // Accumulated per appended sample by the store. Rescanning the whole
    // altitude array here made the work over a ride quadratic.
    const elevationGain = totals.elevationGain;

    // Calories estimation. With a heart-rate sensor, use the HR-based energy
    // expenditure regression (Keytel et al., Journal of Sports Sciences, 2005;
    // age assumed 35 as the athlete's age is not available locally). Without
    // HR, fall back to duration_hours * weight_kg * MET.
    const weightKg = athleteWeight ?? DEFAULT_WEIGHT_KG;
    const durationHours = movingSeconds / 3600;
    let calories: number;
    if (totals.heartrateCount >= 30) {
      const avgHr = totals.heartrateSum / totals.heartrateCount;
      const kcalPerMin = (-55.0969 + 0.6309 * avgHr + 0.1988 * weightKg + 0.2017 * 35) / 4.184;
      calories = Math.round(Math.max(0, kcalPerMin) * (movingSeconds / 60));
    } else {
      const met = getMet(activityType ?? 'Other');
      calories = Math.round(durationHours * weightKg * met);
    }

    // Lap metrics
    const lastLap = laps.length > 0 ? laps[laps.length - 1] : null;
    // The lap stores the stream index it was pressed at, so the in-progress lap
    // starts at the sample after it. Lap time runs on the moving clock.
    const lapStartDistance =
      lastLap && lastLap.endIndex >= 0 ? (streams.distance[lastLap.endIndex] ?? 0) : 0;
    const lapDistance = distance - lapStartDistance;
    const lapStartSeconds = lastLap ? lastLap.movingEndTime : 0;
    const lapTime = Math.max(0, movingSeconds - lapStartSeconds);

    return {
      speed,
      avgSpeed,
      distance,
      heartrate,
      power,
      cadence,
      elevation,
      elevationGain,
      calories,
      lapDistance,
      lapTime,
    };
  }, [
    streams,
    latestSensor,
    nowMs,
    totals,
    laps,
    activityType,
    pauseIntervals,
    openPauseStart,
    startTime,
    athleteWeight,
  ]);
}
