export interface PaceCurveSource {
  distances?: number[] | undefined;
  times?: number[] | undefined;
  pace: number[];
  activity_ids?: string[] | undefined;
}

export interface PaceCurveSample {
  distance: number;
  time: number;
  speed: number;
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
      samples.push({ distance, time, speed, activityId: curve.activity_ids?.[i] });
    }
  }
  return samples;
}
