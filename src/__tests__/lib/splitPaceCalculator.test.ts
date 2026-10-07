/**
 * Scenario: the split banner's pace for the split just completed.
 *
 * Expected behaviour: pace is over moving seconds, so a stop inside the split
 * is not ridden time, and the first split is measured from the first sample,
 * which is at time 0.
 */

import { calculateSplitPace } from '@/features/recording/lib/splitPaceCalculator';

describe('calculateSplitPace', () => {
  it('gives back a closed pause inside the split', () => {
    // 500 m in 150 s, a 600 s stop, then 500 m in 150 s: 300 moving seconds.
    const pace = calculateSplitPace([0, 500, 500, 1000], [0, 150, 750, 900], 1, 1000, true, [
      { start: 150, end: 750 },
    ]);
    expect(pace).toBe('5:00 /km');
  });

  it('measures the first split from the sample at time 0', () => {
    const pace = calculateSplitPace([0, 10, 1000], [0, 60, 300], 1, 1000, true, []);
    expect(pace).toBe('5:00 /km');
  });

  it('counts only the part of a pause that falls inside the split', () => {
    // The second kilometre starts at 300 s. A pause from 200 s to 400 s gives
    // back only its 100 s after the boundary.
    const pace = calculateSplitPace(
      [0, 500, 1000, 1500, 2000],
      [0, 150, 300, 550, 700],
      2,
      1000,
      true,
      [{ start: 200, end: 400 }]
    );
    expect(pace).toBe('5:00 /km');
  });

  it('reads -- when the split has no moving time', () => {
    expect(calculateSplitPace([0, 1000], [0, 0], 1, 1000, true, [])).toBe('--');
    expect(calculateSplitPace([], [], 1, 1000, true, [])).toBe('--');
  });

  it('reads -- when the split boundary has not been reached', () => {
    expect(calculateSplitPace([0, 500], [0, 150], 1, 1000, true, [])).toBe('--');
  });
});
