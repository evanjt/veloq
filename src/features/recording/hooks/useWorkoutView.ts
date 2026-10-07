import { useEffect, useState } from 'react';

import { useRecordingStore, workoutAt, type WorkoutView } from '../stores/RecordingStore';

/**
 * The followed plan as it stands now, re-read each second and on each
 * recorded distance. It runs on the moving clock, so paused it holds.
 */
export function useWorkoutView(): WorkoutView | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  // Each of these is a reason to re-read: a step taken, a pause, a fix.
  const workout = useRecordingStore((s) => s.workout);
  useRecordingStore((s) => s.status);
  useRecordingStore((s) => s.streams.distance.length);
  if (!workout) return null;
  return workoutAt(useRecordingStore.getState(), nowMs);
}
