/**
 * Scenario: the pace snapshot was stamped with the clock, so opening the app
 * against a curve fetched weeks ago wrote today's date into `pace_history`.
 * The Lactate Threshold trend then gained a point a day for a reading that
 * had not moved.
 *
 * Expected behaviour: the snapshot carries the curve's own end date, so
 * re-reading one stored curve is idempotent however many days pass.
 */

import { paceSnapshotDate } from '@/features/stats/lib/paceSnapshot';

const MIDNIGHT_8_AUG = Math.floor(new Date(2026, 7, 8).getTime() / 1000);

describe('paceSnapshotDate', () => {
  it('takes the day from the curve rather than the clock', () => {
    expect(paceSnapshotDate('2026-08-08', new Date(2026, 8, 12, 14, 30))).toBe(MIDNIGHT_8_AUG);
  });

  it('reads the same stored curve to the same day a month later', () => {
    const first = paceSnapshotDate('2026-08-08T00:00:00', new Date(2026, 7, 8, 9));
    const later = paceSnapshotDate('2026-08-08T00:00:00', new Date(2026, 8, 12, 23));
    expect(later).toBe(first);
  });

  it('takes a full local timestamp on the end date, not the time within it', () => {
    expect(paceSnapshotDate('2026-08-08T23:59:59', new Date(2026, 7, 8))).toBe(MIDNIGHT_8_AUG);
  });

  it('falls back to today when the curve names no end date', () => {
    const now = new Date(2026, 8, 12, 14, 30);
    expect(paceSnapshotDate(undefined, now)).toBe(
      Math.floor(new Date(2026, 8, 12).getTime() / 1000)
    );
  });

  it('falls back to today when the end date will not parse', () => {
    const now = new Date(2026, 8, 12, 14, 30);
    expect(paceSnapshotDate('not a date', now)).toBe(
      Math.floor(new Date(2026, 8, 12).getTime() / 1000)
    );
    expect(paceSnapshotDate('', now)).toBe(Math.floor(new Date(2026, 8, 12).getTime() / 1000));
  });
});
