/**
 * Scenario: the histogram plot places the engine's bins and marks on a pixel frame.
 * Expected behaviour: bar heights keep the counts' ratio, a bar is at most 24 px wide and
 * centred in its bin with a gap to the next, a time maps to its bin's span, a time outside
 * the bins has no mark, and count ticks are whole numbers from zero at the baseline.
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

  it('caps six bins on a 340 px plot at 24 px, each centred in its bin', () => {
    const frame = {
      width: 360,
      height: 120,
      padding: { left: 10, right: 10, top: 10, bottom: 10 },
    };
    const { bars } = layoutHistogram(histogram([1, 4, 6, 3, 2, 1]), frame);
    const bin = 340 / 6;

    expect(bars).toHaveLength(6);
    bars.forEach((bar, i) => {
      expect(bar.width).toBeLessThanOrEqual(24);
      expect(bar.width).toBeGreaterThan(0);
      expect(bar.centre).toBeCloseTo(10 + (i + 0.5) * bin);
      expect(bar.x).toBeCloseTo(bar.centre - bar.width / 2);
      expect(bar.binLeft).toBeCloseTo(10 + i * bin);
      expect(bar.binRight).toBeCloseTo(10 + (i + 1) * bin);
    });
  });

  it('leaves a gap of at least 2 px between dense bars', () => {
    const frame = { width: 100, height: 120, padding: { left: 0, right: 0, top: 10, bottom: 10 } };
    const { bars } = layoutHistogram(histogram(Array.from({ length: 20 }, () => 1)), frame);

    for (let i = 1; i < bars.length; i++) {
      const gap = bars[i].x - (bars[i - 1].x + bars[i - 1].width);
      expect(gap).toBeGreaterThanOrEqual(2 - 1e-9);
    }
  });

  it('carries a zero count tick on the baseline', () => {
    const { countTicks } = layoutHistogram(histogram([3, 2]), FRAME);

    expect(countTicks[0]).toEqual({ count: 0, y: 110 });
    expect(countTicks.at(-1)).toEqual({ count: 3, y: 10 });
  });

  it('keeps an empty bin as a zero-height bar so the axis stays even', () => {
    const { bars } = layoutHistogram(histogram([2, 0, 1]), FRAME);

    expect(bars.map((bar) => bar.height)).toEqual([100, 0, 50]);
    expect(bars[1].binLeft).toBeCloseTo(10 + 200 / 3);
  });

  it('places a time inside the first bin within the first bar span', () => {
    const { bars, xForTime } = layoutHistogram(histogram([3, 2]), FRAME);
    const x = xForTime(305)!;

    expect(x).toBeGreaterThanOrEqual(bars[0].binLeft);
    expect(x).toBeLessThan(bars[0].binRight);
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
  it('lists whole counts from zero for a short chart', () => {
    expect(integerCountTicks(3)).toEqual([0, 1, 2, 3]);
  });

  it('thins a tall chart to at most four whole ticks above zero', () => {
    const ticks = integerCountTicks(23);
    expect(ticks[0]).toBe(0);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(ticks.every(Number.isInteger)).toBe(true);
  });

  it('gives the zero tick alone for nothing to count', () => {
    expect(integerCountTicks(0)).toEqual([0]);
    expect(integerCountTicks(NaN)).toEqual([0]);
  });
});
