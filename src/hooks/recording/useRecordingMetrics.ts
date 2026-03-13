import { useMemo } from 'react';
import { useRecordingStore } from '@/providers/RecordingStore';

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
  elevation: number;
  elevationGain: number;
  pace: number;
  avgPace: number;
  calories: number;
  lapDistance: number;
  lapTime: number;
} {
  const streams = useRecordingStore((s) => s.streams);
  const laps = useRecordingStore((s) => s.laps);
  const activityType = useRecordingStore((s) => s.activityType);
  const startTime = useRecordingStore((s) => s.startTime);
  const pausedDuration = useRecordingStore((s) => s.pausedDuration);

  return useMemo(() => {
    const len = streams.time.length;
    if (len === 0) {
      return {
        speed: 0,
        avgSpeed: 0,
        distance: 0,
        heartrate: 0,
        power: 0,
        cadence: 0,
        elevation: 0,
        elevationGain: 0,
        pace: 0,
        avgPace: 0,
        calories: 0,
        lapDistance: 0,
        lapTime: 0,
      };
    }

    // Current values (last element in each stream)
    const lastIdx = len - 1;
    const speed = streams.speed[lastIdx] ?? 0;
    const distance = streams.distance[lastIdx] ?? 0;
    const heartrate = streams.heartrate[lastIdx] ?? 0;
    const power = streams.power[lastIdx] ?? 0;
    const cadence = streams.cadence[lastIdx] ?? 0;
    const elevation = streams.altitude[lastIdx] ?? 0;

    // Average speed
    const elapsedSeconds = streams.time[lastIdx] ?? 0;
    const avgSpeed = elapsedSeconds > 0 ? distance / elapsedSeconds : 0;

    // Pace (seconds per km)
    const pace = speed > 0 ? 1000 / speed : 0;
    const avgPace = avgSpeed > 0 ? 1000 / avgSpeed : 0;

    // Elevation gain: sum of positive altitude differences
    let elevationGain = 0;
    for (let i = 1; i < len; i++) {
      const prev = streams.altitude[i - 1] ?? 0;
      const curr = streams.altitude[i] ?? 0;
      const diff = curr - prev;
      if (diff > 0) {
        elevationGain += diff;
      }
    }

    // Calories estimation: duration_hours * weight_kg * MET
    const met = getMet(activityType ?? 'Other');
    const durationHours = elapsedSeconds / 3600;
    const calories = Math.round(durationHours * DEFAULT_WEIGHT_KG * met);

    // Lap metrics
    const lastLap = laps.length > 0 ? laps[laps.length - 1] : null;
    const lapStartDistance = lastLap
      ? (streams.distance[Math.min(Math.round(lastLap.endTime), lastIdx)] ?? 0)
      : 0;
    const lapDistance = distance - lapStartDistance;
    const lapStartSeconds = lastLap ? lastLap.endTime : 0;
    const movingSeconds = elapsedSeconds - Math.floor(pausedDuration / 1000);
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
      pace,
      avgPace,
      calories,
      lapDistance,
      lapTime,
    };
  }, [streams, laps, activityType, startTime, pausedDuration]);
}
