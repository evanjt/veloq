/**
 * Scenario: strength period and trailing-week windows are built from the device
 * clock, then compared against `activity_metrics.date`, a wall clock stamped as
 * UTC (`persistence/strength.rs:151-167`). Expected behaviour: the bounds carry
 * the athlete's local calendar whatever the device offset, so an evening
 * session counts in the week it happened.
 */
import {
  getTimestampRange,
  getTrailingWeekRanges,
} from '@/features/strength/hooks/useStrengthVolume';

const withTz = <T>(tz: string, run: () => T): T => {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    process.env.TZ = original;
  }
};

const iso = (ts: number) => new Date(ts * 1000).toISOString();

describe('strength window timebase', () => {
  it.each(['Australia/Sydney', 'America/Los_Angeles', 'UTC'])(
    'ends the period at local end-of-day in %s',
    (tz) => {
      const { endTs } = withTz(tz, () => getTimestampRange('week'));
      expect(iso(endTs)).toMatch(/T23:59:59\.000Z$/);
    }
  );

  it.each(['Australia/Sydney', 'America/Los_Angeles', 'UTC'])(
    'starts the period at local midnight in %s',
    (tz) => {
      const { startTs } = withTz(tz, () => getTimestampRange('week'));
      expect(iso(startTs)).toMatch(/T00:00:00\.000Z$/);
    }
  );

  it('spans exactly the requested days', () => {
    const { startTs, endTs } = withTz('Australia/Sydney', () => getTimestampRange('week'));
    expect(endTs - startTs).toBe(7 * 86400 + 86399);
  });

  it.each(['Australia/Sydney', 'America/Los_Angeles'])(
    'gives each trailing week a whole local day at both ends in %s',
    (tz) => {
      const ranges = withTz(tz, () => getTrailingWeekRanges(4));
      expect(ranges).toHaveLength(4);
      for (const range of ranges) {
        expect(iso(range.startTs)).toMatch(/T00:00:00\.000Z$/);
        expect(iso(range.endTs)).toMatch(/T23:59:59\.000Z$/);
        expect(range.endTs - range.startTs).toBe(6 * 86400 + 86399);
      }
    }
  );

  it('leaves no gap and no overlap between consecutive weeks', () => {
    const ranges = withTz('Australia/Sydney', () => getTrailingWeekRanges(4));
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i].startTs - ranges[i - 1].endTs).toBe(1);
    }
  });
});
