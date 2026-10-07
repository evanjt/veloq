import type { SectionPerformanceRecord } from '@/features/routes';

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
    const directionalTime =
      bestRecord.direction === 'reverse'
        ? (r.bestReverseTime ??
          (r.bestReverseTime === undefined && r.direction === 'reverse' ? r.bestTime : null))
        : (r.bestForwardTime ??
          (r.bestForwardTime === undefined && r.direction === 'same' ? r.bestTime : null));
    if (directionalTime == null || !Number.isFinite(directionalTime) || directionalTime <= 0)
      continue;
    if (!secondBest || directionalTime < secondBest.bestTime) {
      secondBest = { ...r, bestTime: directionalTime };
    }
  }
  return secondBest;
}
