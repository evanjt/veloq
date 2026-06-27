import { formatPace } from '@/shared/format/format';

// Compute the pace for the split that just completed: find the time at the
// previous and current split boundaries, then format the per-split pace.
export function calculateSplitPace(
  distance: number[],
  time: number[],
  splitIndex: number,
  splitUnit: number,
  isMetric: boolean
): string {
  const prevSplitDist = (splitIndex - 1) * splitUnit;
  const nextSplitDistance = splitIndex * splitUnit;
  let prevSplitTime = 0;
  let currSplitTime = 0;
  for (let i = 0; i < distance.length; i++) {
    if (distance[i] >= prevSplitDist && prevSplitTime === 0) {
      prevSplitTime = time[i];
    }
    if (distance[i] >= nextSplitDistance && currSplitTime === 0) {
      currSplitTime = time[i];
      break;
    }
  }
  const splitSeconds = currSplitTime - prevSplitTime;
  return splitSeconds > 0
    ? isMetric
      ? formatPace(splitUnit / splitSeconds, true)
      : formatPace(splitUnit / splitSeconds, false)
    : '--';
}
