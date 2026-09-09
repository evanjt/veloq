/**
 * Scenario: the bulk sync decides per activity whether to download every
 * series or only the three the track needs. Rust makes the decision but cannot
 * make it alone: `activities.start_date` is filled by the metrics sync, which
 * lands after the GPS sync on a first run.
 *
 * Expected behaviour: the date travels as epoch seconds, and an activity whose
 * date will not parse travels as undefined rather than as a wrong number.
 */

import { activityStartEpoch } from '@/features/routes/lib/streamWindow';

describe('activityStartEpoch', () => {
  it('converts a local start date to epoch seconds', () => {
    const parsed = activityStartEpoch('2026-08-30T07:15:00');
    expect(parsed).toBe(BigInt(Math.floor(Date.parse('2026-08-30T07:15:00') / 1000)));
  });

  it('reads a date that will not parse as unknown, not as the epoch', () => {
    expect(activityStartEpoch('not a date')).toBeUndefined();
  });

  it('reads a missing date as unknown', () => {
    expect(activityStartEpoch(undefined)).toBeUndefined();
    expect(activityStartEpoch(null)).toBeUndefined();
    expect(activityStartEpoch('')).toBeUndefined();
  });
});
