import { addLocalDays } from './localDay';
import { localWallClockToEpochSeconds } from './startDate';

/**
 * The trailing weeks ending today, oldest first. Each is seven local days,
 * midnight to 23:59:59, and the last ends tonight, so the weeks meet with no
 * gap and no overlap. Bounds are in the wall-clock-as-UTC space the engine
 * stamps `activity_metrics.date` in.
 *
 * The strength tab draws these weeks and the strength insights compare them,
 * and a card opens that tab, so both ask here.
 */
export function trailingWeekRanges(weekCount: number): { startTs: number; endTs: number }[] {
  const end = new Date();
  end.setHours(23, 59, 59, 0);

  const ranges: { startTs: number; endTs: number }[] = [];
  for (let index = weekCount - 1; index >= 0; index -= 1) {
    const rangeEnd = addLocalDays(end, -index * 7);

    const rangeStart = addLocalDays(rangeEnd, -6);
    rangeStart.setHours(0, 0, 0, 0);

    ranges.push({
      startTs: localWallClockToEpochSeconds(rangeStart),
      endTs: localWallClockToEpochSeconds(rangeEnd),
    });
  }

  return ranges;
}

/**
 * The `days` before `now` through the end of its day, as wall-clock stamps: the
 * same calendar days a trailing range of that length is captioned with.
 */
export function trailingDaysWindow(days: number, now: Date): { startTs: number; endTs: number } {
  const end = new Date(now);
  end.setHours(23, 59, 59, 0);
  const start = addLocalDays(now, -days);
  start.setHours(0, 0, 0, 0);
  return {
    startTs: localWallClockToEpochSeconds(start),
    endTs: localWallClockToEpochSeconds(end),
  };
}
