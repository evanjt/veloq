/**
 * Scenario: a section PR card names the previous best. The records it chooses
 * from can carry a `bestTime` of 0, which is what an untimed or mis-ingested
 * traversal reads as, and 0 compares faster than every real time.
 *
 * Expected behaviour: only a finite, positive time is a candidate, matching the
 * filter `computeSectionPrDelta` already applies to the same records. Direction
 * is deliberately not considered here; that is an open question.
 */

import { findPreviousBest } from '@/features/insights/lib/previousBest';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

function record(activityId: string, bestTime: number): SectionPerformanceRecord {
  return {
    activityId,
    activityName: activityId,
    activityDate: new Date('2026-01-01'),
    laps: [],
    lapCount: 1,
    bestTime,
    bestPace: bestTime > 0 ? 1000 / bestTime : 0,
  } as unknown as SectionPerformanceRecord;
}

const pr = record('pr', 400);

describe('findPreviousBest', () => {
  it('ignores a zero time rather than calling it the previous best', () => {
    const previous = findPreviousBest([pr, record('untimed', 0), record('real', 430)], pr);

    expect(previous?.activityId).toBe('real');
  });

  it('ignores a negative and a non-finite time', () => {
    const records = [
      pr,
      record('negative', -5),
      record('nan', Number.NaN),
      record('infinite', Number.POSITIVE_INFINITY),
      record('real', 450),
    ];

    expect(findPreviousBest(records, pr)?.activityId).toBe('real');
  });

  it('answers null when every other record is unusable', () => {
    expect(findPreviousBest([pr, record('untimed', 0)], pr)).toBeNull();
    expect(findPreviousBest([pr, record('nan', Number.NaN)], pr)).toBeNull();
  });

  it('answers null without a PR record, or with nothing to compare', () => {
    expect(findPreviousBest([pr], pr)).toBeNull();
    expect(findPreviousBest([], null)).toBeNull();
    expect(findPreviousBest([pr, record('real', 430)], null)).toBeNull();
  });

  it('takes the fastest of the remaining records, not merely the first', () => {
    const records = [pr, record('slow', 600), record('quick', 410), record('mid', 500)];

    expect(findPreviousBest(records, pr)?.activityId).toBe('quick');
  });

  it('excludes the PR itself even when it appears more than once', () => {
    const previous = findPreviousBest([pr, pr, record('real', 430)], pr);

    expect(previous?.activityId).toBe('real');
  });
});
