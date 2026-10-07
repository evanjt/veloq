/**
 * Scenario: the histogram plot places the engine's bins and marks on a pixel frame.
 * Expected behaviour: bar heights keep the counts' ratio, a time maps to its bin's
 * span, a time outside the bins has no mark, and count ticks are whole numbers.
 */

import type { FfiAttemptHistogram } from 'veloqrs';
import { integerCountTicks, layoutHistogram } from '@/features/routes/lib/histogramLayout';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const FRAME = { width: 220, height: 120, padding: { left: 10, right: 10, top: 10, bottom: 10 } };

function histogram(counts: number[]): FfiAttemptHistogram {
  return {
    startSecs: 300,
    binWidthSecs: 30,
    counts,
    binned: counts.reduce((a, b) => a + b, 0),
    unbinnedOutsideBand: 0,
  };
}

describe('layoutHistogram', () => {
  it('draws bars in the ratio of the counts, tallest filling the plot', () => {
    const { bars } = layoutHistogram(histogram([3, 2]), FRAME);

    expect(bars).toHaveLength(2);
    expect(bars[0].height).toBe(100);
    expect(bars[0].height / bars[1].height).toBeCloseTo(3 / 2);
    expect(bars[0].y + bars[0].height).toBe(bars[1].y + bars[1].height);
  });

  it('keeps an empty bin as a zero-height bar so the axis stays even', () => {
    const { bars } = layoutHistogram(histogram([2, 0, 1]), FRAME);

    expect(bars.map((bar) => bar.height)).toEqual([100, 0, 50]);
    expect(bars[1].x).toBeCloseTo(10 + 200 / 3);
  });

  it('places a time inside the first bin within the first bar span', () => {
    const { bars, xForTime } = layoutHistogram(histogram([3, 2]), FRAME);
    const x = xForTime(305)!;

    expect(x).toBeGreaterThanOrEqual(bars[0].x);
    expect(x).toBeLessThan(bars[0].x + bars[0].width);
  });

  it('closes the last bin and refuses a time outside the bins', () => {
    const { xForTime } = layoutHistogram(histogram([3, 2]), FRAME);

    expect(xForTime(360)).toBe(210);
    expect(xForTime(299)).toBeNull();
    expect(xForTime(361)).toBeNull();
    expect(xForTime(NaN)).toBeNull();
  });

  it('survives a single bin and an empty one', () => {
    expect(layoutHistogram(histogram([4]), FRAME).bars).toHaveLength(1);
    const empty = layoutHistogram(histogram([]), FRAME);
    expect(empty.bars).toEqual([]);
    expect(empty.xForTime(300)).toBeNull();
  });
});

describe('integerCountTicks', () => {
  it('lists whole counts for a short chart', () => {
    expect(integerCountTicks(3)).toEqual([1, 2, 3]);
  });

  it('thins a tall chart to at most four whole ticks', () => {
    const ticks = integerCountTicks(23);
    expect(ticks.length).toBeLessThanOrEqual(4);
    expect(ticks.every(Number.isInteger)).toBe(true);
  });

  it('gives no ticks for nothing to count', () => {
    expect(integerCountTicks(0)).toEqual([]);
    expect(integerCountTicks(NaN)).toEqual([]);
  });
});
