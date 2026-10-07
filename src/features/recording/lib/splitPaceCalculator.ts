import { formatPace } from '@/shared/format/format';
import { pausedSecondsBetween, type PauseInterval } from './pausedTime';

// Compute the pace for the split that just completed: find the samples at the
// previous and current split boundaries, then format the pace over the moving
// seconds between them. Stream times are wall clock, so the pauses inside the
// split are given back.
export function calculateSplitPace(
  distance: number[],
  time: number[],
  splitIndex: number,
  splitUnit: number,
  isMetric: boolean,
  pauseIntervals: readonly PauseInterval[]
): string {
  const prevSplitDist = (splitIndex - 1) * splitUnit;
  const nextSplitDistance = splitIndex * splitUnit;
  const prev = distance.findIndex((d) => d >= prevSplitDist);
  const curr = distance.findIndex((d) => d >= nextSplitDistance);
  if (prev < 0 || curr < 0) return '--';
  const splitSeconds =
    time[curr] - time[prev] - pausedSecondsBetween(pauseIntervals, time[prev], time[curr]);
  return splitSeconds > 0 ? formatPace(splitUnit / splitSeconds, isMetric) : '--';
}
