/**
 * Scenario: a section PR card names the previous best, and the record it
 * chose could be a traversal the other way. A personal record in this app is
 * a beat over the same section and direction pair, which is what
 * `persistence/records.rs` writes and what `computeSectionPrDelta` already
 * filters on, so a reverse traversal is a different effort.
 *
 * Expected behaviour: the previous best is the fastest other record in the
 * PR's own direction, and the two readers of the same records agree on it.
 */

import { findPreviousBest } from '@/features/insights/lib/previousBest';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

function record(
  activityId: string,
  bestTime: number,
  direction: 'same' | 'reverse' = 'same'
): SectionPerformanceRecord {
  return {
    activityId,
    activityName: activityId,
    activityDate: new Date('2026-01-01'),
    laps: [],
    lapCount: 1,
    bestTime,
    bestPace: bestTime > 0 ? 1000 / bestTime : 0,
    direction,
  } as unknown as SectionPerformanceRecord;
}

const pr = record('pr', 400);

describe('the previous best takes the direction', () => {
  it('skips a faster traversal the other way, which is a different effort', () => {
    const previous = findPreviousBest(
      [pr, record('back', 380, 'reverse'), record('real', 430)],
      pr
    );

    expect(previous?.activityId).toBe('real');
  });

  it('is null when every other timed effort went the other way', () => {
    expect(findPreviousBest([pr, record('back', 380, 'reverse')], pr)).toBeNull();
  });

  it('takes the reverse direction when the PR itself is a reverse traversal', () => {
    const reversePr = record('pr', 400, 'reverse');
    const previous = findPreviousBest(
      [reversePr, record('forward', 380), record('back', 430, 'reverse')],
      reversePr
    );

    expect(previous?.activityId).toBe('back');
  });

  it('agrees with the delta the notification quotes from the same records', () => {
    const records = [pr, record('back', 380, 'reverse'), record('real', 430)];
    const previous = findPreviousBest(records, pr);

    // computeSectionPrDelta reads min(others in the PR's direction) - best.
    const others = records.filter((r) => r.activityId !== 'pr' && r.direction === pr.direction);
    expect(previous?.bestTime).toBe(Math.min(...others.map((r) => r.bestTime)));
  });
});
