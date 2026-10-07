import type { SectionPerformanceRecord } from '@/features/routes';

/**
 * A section's best in each direction, with whether the engine judges it a
 * record. A record is a beat over another outing in the same
 * direction, so a lone descent beside many climbs is a best and not a record,
 * and a descent is never set against a climb.
 */
export interface DirectionBests {
  forward: SectionPerformanceRecord | null;
  reverse: SectionPerformanceRecord | null;
  forwardIsPr: boolean;
  reverseIsPr: boolean;
}

export const NO_BESTS: DirectionBests = {
  forward: null,
  reverse: null,
  forwardIsPr: false,
  reverseIsPr: false,
};

/** The record the engine judges a PR, the most recently set when both directions hold one. */
export function prRecordOf(bests: DirectionBests): SectionPerformanceRecord | null {
  const prs = [
    bests.forwardIsPr ? bests.forward : null,
    bests.reverseIsPr ? bests.reverse : null,
  ].filter((r): r is SectionPerformanceRecord => r != null);
  if (prs.length === 0) return null;
  return prs.reduce((latest, r) =>
    r.activityDate.getTime() > latest.activityDate.getTime() ? r : latest
  );
}

export type EffortDirection = 'forward' | 'reverse';

/** One direction's effort on a section: an out-and-back activity yields two. */
export interface DirectionEffort {
  record: SectionPerformanceRecord;
  direction: EffortDirection;
  time: number;
  isPr: boolean;
  /** Seconds slower than the best of this direction, null for the best itself or when it has none. */
  delta: number | null;
}

function isTime(time: number | null | undefined): time is number {
  return time != null && Number.isFinite(time);
}

/**
 * The efforts of every record split by direction, each with its own time,
 * record verdict and delta against the best of that direction. A record
 * contributes a forward effort when it has a forward time and a reverse effort
 * when it has a reverse time, so an out-and-back is two efforts.
 */
export function directionEfforts(
  records: SectionPerformanceRecord[],
  bests: DirectionBests
): DirectionEffort[] {
  const efforts: DirectionEffort[] = [];
  for (const record of records) {
    for (const direction of ['forward', 'reverse'] as const) {
      const reverse = direction === 'reverse';
      const time = reverse ? record.bestReverseTime : record.bestForwardTime;
      if (!isTime(time)) continue;
      const best = reverse ? bests.reverse : bests.forward;
      const bestIsPr = reverse ? bests.reverseIsPr : bests.forwardIsPr;
      const isBest = best?.activityId === record.activityId;
      const bestTime = reverse ? best?.bestReverseTime : best?.bestForwardTime;
      efforts.push({
        record,
        direction,
        time,
        isPr: bestIsPr && isBest,
        delta: isBest || !isTime(bestTime) ? null : time - bestTime,
      });
    }
  }
  return efforts;
}

/** The direction a single-series chart plots: the one holding the latest record, else the busier one. */
export function plottedDirection(
  efforts: DirectionEffort[],
  bests: DirectionBests
): EffortDirection {
  const pr = prRecordOf(bests);
  if (pr) return pr === bests.reverse && pr !== bests.forward ? 'reverse' : 'forward';
  const reverseCount = efforts.filter((e) => e.direction === 'reverse').length;
  return reverseCount > efforts.length - reverseCount ? 'reverse' : 'forward';
}
