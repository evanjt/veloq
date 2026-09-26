/**
 * Scenario: the eFTP card reads "x% from 3 months ago" under the trend chart.
 * Expected behaviour: the baseline is the newest sample at least 90 days back,
 * whatever the sampling interval.
 *
 * eFTP points arrive per test, not per month, so counting four samples back
 * reads three tests ago. On a weekly tester that is three weeks.
 */

import { ftpChangeOverDays } from '@/features/stats/lib/ftpTrend';

const point = (date: string, eftp: number) => ({ date, eftp });

describe('ftpChangeOverDays', () => {
  it('takes the newest sample at or before the cutoff, not a fixed count back', () => {
    const weekly = [
      point('2026-06-01', 250),
      point('2026-06-08', 255),
      point('2026-06-15', 258),
      point('2026-06-22', 260),
      point('2026-06-29', 262),
      point('2026-09-01', 300),
    ];

    // 2026-09-01 less 90 days is 2026-06-03, so 2026-06-01 at 250W is the
    // baseline. Four samples back is 2026-06-15 at 258W.
    expect(ftpChangeOverDays(weekly, 90)).toEqual({ baseline: 250, latest: 300, change: 50 });
  });

  it('falls back to the oldest sample when the history is shorter than the window', () => {
    const short = [point('2026-08-20', 270), point('2026-09-01', 290)];

    expect(ftpChangeOverDays(short, 90)).toEqual({ baseline: 270, latest: 290, change: 20 });
  });

  it('reads no change from a single sample', () => {
    expect(ftpChangeOverDays([point('2026-09-01', 290)], 90)).toEqual({
      baseline: 290,
      latest: 290,
      change: 0,
    });
  });

  it('answers zero for an empty history', () => {
    expect(ftpChangeOverDays([], 90)).toEqual({ baseline: 0, latest: 0, change: 0 });
  });

  it('ignores a sample whose date will not parse rather than reading NaN', () => {
    const withJunk = [point('not a date', 100), point('2026-06-01', 250), point('2026-09-01', 300)];

    expect(ftpChangeOverDays(withJunk, 90)).toEqual({ baseline: 250, latest: 300, change: 50 });
  });
});
