/**
 * Scenario: the split banner's pace for the split just completed.
 *
 * Expected behaviour: pace is over moving seconds, so a stop inside the split
 * is not ridden time, and the first split is measured from the first sample,
 * which is at time 0.
 */

import { recordings } from 'veloqrs';

import { calculateSplitPace } from '@/features/recording/lib/splitPaceCalculator';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

// The engine owns the pace rule: its answer here names the speed it was asked
// for, so the moving seconds are what this suite reads back.
const livePace = recordings.livePace as jest.Mock;
beforeEach(() => {
  livePace.mockReset();
  livePace.mockImplementation((speed: number, _sport: string | undefined, isMetric: boolean) => ({
    text: `${(1000 / speed).toFixed(0)} s ${isMetric ? '/km' : '/mi'}`,
    seconds: undefined,
  }));
});

describe('calculateSplitPace', () => {
  it('gives back a closed pause inside the split', () => {
    // 500 m in 150 s, a 600 s stop, then 500 m in 150 s: 300 moving seconds.
    const pace = calculateSplitPace([0, 500, 500, 1000], [0, 150, 750, 900], 1, 1000, true, [
      { start: 150, end: 750 },
    ]);
    expect(pace).toBe('300 s /km');
  });

  it('measures the first split from the sample at time 0', () => {
    const pace = calculateSplitPace([0, 10, 1000], [0, 60, 300], 1, 1000, true, []);
    expect(pace).toBe('300 s /km');
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
    expect(pace).toBe('300 s /km');
  });

  it('asks the engine for the split speed in the chosen unit system', () => {
    calculateSplitPace([0, 1609.344], [0, 480], 1, 1609.344, false, []);
    expect(livePace).toHaveBeenCalledWith(1609.344 / 480, undefined, false);
  });

  it('reads -- when the split has no moving time', () => {
    expect(calculateSplitPace([0, 1000], [0, 0], 1, 1000, true, [])).toBe('--');
    expect(calculateSplitPace([], [], 1, 1000, true, [])).toBe('--');
    expect(livePace).not.toHaveBeenCalled();
  });

  it('reads -- when the split boundary has not been reached', () => {
    expect(calculateSplitPace([0, 500], [0, 150], 1, 1000, true, [])).toBe('--');
  });
});
