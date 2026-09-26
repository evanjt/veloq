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
 * Only the PR's own direction counts. A personal record here is a beat over
 * the same section and direction pair, which is what the engine writes in
 * `persistence/records.rs`, so a traversal the other way is a different
 * effort however fast it was. `computeSectionPrDelta` filters on the same
 * field, and the two disagreeing is what let one card name an attempt the
 * other did not.
 */
export function findPreviousBest(
  records: SectionPerformanceRecord[],
  bestRecord: SectionPerformanceRecord | null
): SectionPerformanceRecord | null {
  if (!bestRecord) return null;

  let secondBest: SectionPerformanceRecord | null = null;
  for (const r of records) {
    if (r.activityId === bestRecord.activityId) continue;
    if (r.direction !== bestRecord.direction) continue;
    if (!Number.isFinite(r.bestTime) || r.bestTime <= 0) continue;
    if (!secondBest || r.bestTime < secondBest.bestTime) {
      secondBest = r;
    }
  }
  return secondBest;
}
