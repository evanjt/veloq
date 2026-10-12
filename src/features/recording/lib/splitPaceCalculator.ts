import { formatPace } from '@/shared/format/format';
import { pausedSecondsBetween, type PauseInterval } from './pausedTime';
import { ABSENT } from '@/shared/format/absent';

// The moving seconds of the split that just completed, which is its pace in
// seconds per split unit: find the samples at the previous and current split
// boundaries and take the time between them. Stream times are wall clock, so
// the pauses inside the split are given back. Null when the boundary has not
// been reached or the split has no moving time.
export function splitMovingSeconds(
  distance: number[],
  time: number[],
  splitIndex: number,
  splitUnit: number,
  pauseIntervals: readonly PauseInterval[]
): number | null {
  const prevSplitDist = (splitIndex - 1) * splitUnit;
  const nextSplitDistance = splitIndex * splitUnit;
  const prev = distance.findIndex((d) => d >= prevSplitDist);
  const curr = distance.findIndex((d) => d >= nextSplitDistance);
  if (prev < 0 || curr < 0) return null;
  const splitSeconds =
    time[curr] - time[prev] - pausedSecondsBetween(pauseIntervals, time[prev], time[curr]);
  return splitSeconds > 0 ? splitSeconds : null;
}

// The pace of the split that just completed, formatted for the screen.
export function calculateSplitPace(
  distance: number[],
  time: number[],
  splitIndex: number,
  splitUnit: number,
  isMetric: boolean,
  pauseIntervals: readonly PauseInterval[]
): string {
  const splitSeconds = splitMovingSeconds(distance, time, splitIndex, splitUnit, pauseIntervals);
  return splitSeconds === null ? ABSENT : formatPace(splitUnit / splitSeconds, isMetric);
}
