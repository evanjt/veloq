import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

/**
 * The fastest record other than the PR, which is the "previous best" a PR card
 * reports against.
 *
 * Only a finite, positive `bestTime` is a candidate. An untimed or
 * mis-ingested traversal stores 0, which compares faster than every real time
 * and would otherwise be named as the previous best with an improvement equal
 * to the whole PR. `computeSectionPrDelta` applies the same filter to the same
 * records.
 *
 * Direction is deliberately not considered: whether a traversal the other way
 * is comparable at all is an open question, and this answers only the validity
 * of the times.
 */
export function findPreviousBest(
  records: SectionPerformanceRecord[],
  bestRecord: SectionPerformanceRecord | null
): SectionPerformanceRecord | null {
  if (!bestRecord) return null;

  let secondBest: SectionPerformanceRecord | null = null;
  for (const r of records) {
    if (r.activityId === bestRecord.activityId) continue;
    if (!Number.isFinite(r.bestTime) || r.bestTime <= 0) continue;
    if (!secondBest || r.bestTime < secondBest.bestTime) {
      secondBest = r;
    }
  }
  return secondBest;
}
