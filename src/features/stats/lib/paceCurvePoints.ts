import type { FfiPaceText } from 'veloqrs';

export interface PaceCurveSource {
  distances?: number[] | undefined;
  times?: number[] | undefined;
  pace: number[];
  /** The engine's pace text for each of `pace`, in both unit systems. */
  pace_texts?: (FfiPaceText | undefined)[] | undefined;
  activity_ids?: string[] | undefined;
}

export interface PaceCurveSample {
  distance: number;
  time: number;
  speed: number;
  /** The engine's text for `speed`, absent where it wrote none. */
  paceText?: FfiPaceText | undefined;
  activityId?: string | undefined;
}

/** Every stored point with a positive distance, time and speed. Pace is never a reason to drop one. */
export function paceCurveSamples(curve: PaceCurveSource | null | undefined): PaceCurveSample[] {
  if (!curve?.distances || !curve.times) return [];
  const samples: PaceCurveSample[] = [];
  for (let i = 0; i < curve.distances.length; i++) {
    const distance = curve.distances[i];
    const time = curve.times[i];
    const speed = curve.pace[i];
    if (distance > 0 && time > 0 && speed > 0) {
      samples.push({
        distance,
        time,
        speed,
        paceText: curve.pace_texts?.[i],
        activityId: curve.activity_ids?.[i],
      });
    }
  }
  return samples;
}
