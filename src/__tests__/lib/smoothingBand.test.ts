/**
 * Scenario: the section scatter chart draws a confidence band around a trend.
 *
 * Expected behaviour: the band measures spread about the fitted line. Measuring
 * it about a single fitted point folds the slope into the band, so exactly the
 * sections that are trending get a band covering the whole plot.
 */
import { gaussianSmooth } from '@/shared/math/smoothing';

describe('gaussianSmooth confidence band', () => {
  it('reports no spread for perfectly linear data', () => {
    const xs = Array.from({ length: 10 }, (_, i) => i);
    const ys = xs.map((x) => 1 + 2 * x);

    const smoothed = gaussianSmooth(xs, ys, 20);

    for (const point of smoothed) {
      expect(point.std).toBeLessThan(0.01);
    }
  });

  it('still reports spread when the data is genuinely scattered', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i);
    const ys = xs.map((x, i) => 100 + (i % 2 === 0 ? 10 : -10) + x * 0);

    const smoothed = gaussianSmooth(xs, ys, 10);
    const mean = smoothed.reduce((sum, p) => sum + p.std, 0) / smoothed.length;

    expect(mean).toBeGreaterThan(5);
  });

  it('tracks the trend itself', () => {
    const xs = Array.from({ length: 10 }, (_, i) => i);
    const ys = xs.map((x) => 1 + 2 * x);

    const smoothed = gaussianSmooth(xs, ys, 10);

    expect(smoothed[0].y).toBeCloseTo(1, 0);
    expect(smoothed[smoothed.length - 1].y).toBeCloseTo(19, 0);
  });

  it('reports no spread for two points, which a line fits exactly', () => {
    expect(gaussianSmooth([0, 1], [5, 9]).every((p) => p.std === 0)).toBe(true);
  });
});
