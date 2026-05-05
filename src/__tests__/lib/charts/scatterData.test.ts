/**
 * Tests for scatter-chart data-prep helpers.
 */

import { splitAndPositionChartData, buildTrendWithBand } from '@/lib/charts/scatterData';
import type { PerformanceDataPoint } from '@/types';

type InputPoint = PerformanceDataPoint & { x: number };

function point(overrides: Partial<InputPoint>): InputPoint {
  return {
    date: new Date('2024-06-15'),
    speed: 5,
    activityId: 'a',
    x: 0,
    ...overrides,
  } as InputPoint;
}

describe('splitAndPositionChartData', () => {
  it('returns EMPTY_SPLIT for empty input', () => {
    const result = splitAndPositionChartData([]);
    expect(result.allPoints).toEqual([]);
    expect(result.forwardPoints).toEqual([]);
    expect(result.reversePoints).toEqual([]);
    expect(result.forwardBestIdx).toBe(-1);
    expect(result.reverseBestIdx).toBe(-1);
  });

  it('returns EMPTY_SPLIT when no points have valid dates', () => {
    const result = splitAndPositionChartData([
      // @ts-expect-error — deliberately invalid date
      point({ date: 'not-a-date' }),
      point({ date: new Date('not a date') }),
    ]);
    expect(result.allPoints).toEqual([]);
  });

  it('places a single point with normalized x ~0.02', () => {
    const result = splitAndPositionChartData([point({ speed: 3, sectionTime: 300 })]);
    expect(result.allPoints).toHaveLength(1);
    expect(result.forwardPoints).toHaveLength(1);
    expect(result.forwardBestIdx).toBe(0);
    expect(result.allPoints[0].x).toBeCloseTo(0.02, 5);
  });

  it('splits forward vs reverse points correctly', () => {
    const pts: InputPoint[] = [
      point({ date: new Date('2024-01-01'), speed: 5 }),
      point({ date: new Date('2024-02-01'), speed: 6, direction: 'reverse' }),
      point({ date: new Date('2024-03-01'), speed: 4 }),
    ];
    const result = splitAndPositionChartData(pts);
    expect(result.forwardPoints).toHaveLength(2);
    expect(result.reversePoints).toHaveLength(1);
  });

  it('identifies the shortest-time non-excluded point as best by default', () => {
    const pts: InputPoint[] = [
      point({ date: new Date('2024-01-01'), speed: 5, sectionTime: 600 }),
      point({ date: new Date('2024-02-01'), speed: 7, sectionTime: 300 }),
      point({ date: new Date('2024-03-01'), speed: 6, sectionTime: 450 }),
    ];
    const result = splitAndPositionChartData(pts);
    expect(result.forwardBestIdx).toBe(1);
  });

  it('identifies the fastest-speed point as best when bestBy is speed', () => {
    const pts: InputPoint[] = [
      point({ date: new Date('2024-01-01'), speed: 8, sectionTime: 600 }),
      point({ date: new Date('2024-02-01'), speed: 5, sectionTime: 200 }),
      point({ date: new Date('2024-03-01'), speed: 6, sectionTime: 450 }),
    ];
    const result = splitAndPositionChartData(pts, 'speed');
    expect(result.forwardBestIdx).toBe(0);
  });

  it('speed and time best can disagree when section distances vary', () => {
    const pts: InputPoint[] = [
      point({ date: new Date('2024-01-01'), speed: 10, sectionTime: 500 }),
      point({ date: new Date('2024-02-01'), speed: 6, sectionTime: 200 }),
    ];
    const bySpeed = splitAndPositionChartData(pts, 'speed');
    const byTime = splitAndPositionChartData(pts, 'time');
    expect(bySpeed.forwardBestIdx).toBe(0);
    expect(byTime.forwardBestIdx).toBe(1);
  });

  it('excludes isExcluded points from best-index computation', () => {
    const pts: InputPoint[] = [
      point({ date: new Date('2024-01-01'), speed: 5, sectionTime: 600 }),
      point({ date: new Date('2024-02-01'), speed: 9, sectionTime: 200, isExcluded: true }),
      point({ date: new Date('2024-03-01'), speed: 6, sectionTime: 450 }),
    ];
    const result = splitAndPositionChartData(pts);
    expect(result.forwardBestIdx).toBe(2);
  });

  it('returns reverseBestIdx = -1 when there are no reverse points', () => {
    const pts: InputPoint[] = [point({ speed: 5 }), point({ speed: 6 })];
    const result = splitAndPositionChartData(pts);
    expect(result.reverseBestIdx).toBe(-1);
    expect(result.reversePoints).toEqual([]);
  });

  it('normalizes x to the range [0.02, 0.98] across the date span', () => {
    const pts: InputPoint[] = [
      point({ date: new Date('2024-01-01'), speed: 4 }),
      point({ date: new Date('2024-06-01'), speed: 5 }),
      point({ date: new Date('2024-12-31'), speed: 6 }),
    ];
    const result = splitAndPositionChartData(pts);
    const xs = result.allPoints.map((p) => p.x);
    expect(xs[0]).toBeCloseTo(0.02, 5);
    expect(xs[xs.length - 1]).toBeCloseTo(0.98, 5);
    expect(xs[1]).toBeGreaterThan(xs[0]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it('applies 15% padding to speed domain with floor at 0', () => {
    const pts: InputPoint[] = [
      point({ date: new Date('2024-01-01'), speed: 10 }),
      point({ date: new Date('2024-02-01'), speed: 20 }),
    ];
    const result = splitAndPositionChartData(pts);
    // Range is 10, 15% padding = 1.5
    expect(result.maxSpeed).toBeCloseTo(21.5, 4);
    expect(result.minSpeed).toBeCloseTo(8.5, 4);
  });

  it('uses fallback padding of 0.5 when all speeds are identical', () => {
    const pts: InputPoint[] = [
      point({ date: new Date('2024-01-01'), speed: 5 }),
      point({ date: new Date('2024-02-01'), speed: 5 }),
    ];
    const result = splitAndPositionChartData(pts);
    // max - min = 0, so padding = 0.5 (from `|| 0.5`)
    expect(result.maxSpeed).toBeCloseTo(5.5, 4);
    expect(result.minSpeed).toBeCloseTo(4.5, 4);
  });

  it('floors minSpeed at 0 when padding would push it negative', () => {
    // Zero speed with small delta → 15% padding pushes min to -0.015, clamped to 0
    const pts: InputPoint[] = [
      point({ date: new Date('2024-01-01'), speed: 0 }),
      point({ date: new Date('2024-02-01'), speed: 0.1 }),
    ];
    const result = splitAndPositionChartData(pts);
    expect(result.minSpeed).toBe(0);
  });

  it('sorts points by date before assigning x coordinates', () => {
    const pts: InputPoint[] = [
      point({ date: new Date('2024-03-01'), speed: 5, activityId: 'c' }),
      point({ date: new Date('2024-01-01'), speed: 4, activityId: 'a' }),
      point({ date: new Date('2024-02-01'), speed: 6, activityId: 'b' }),
    ];
    const result = splitAndPositionChartData(pts);
    expect(result.allPoints.map((p) => p.activityId)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildTrendWithBand', () => {
  it('returns null when given fewer than 2 points', () => {
    expect(buildTrendWithBand([])).toBeNull();
    expect(buildTrendWithBand([{ ...point({}), speed: 5 }])).toBeNull();
  });

  it('returns a smoothed trend with confidence band for ≥2 points', () => {
    const pts: InputPoint[] = [
      { ...point({}), x: 0.0, speed: 4 },
      { ...point({}), x: 0.2, speed: 5 },
      { ...point({}), x: 0.5, speed: 6 },
      { ...point({}), x: 0.7, speed: 5 },
      { ...point({}), x: 1.0, speed: 7 },
    ];
    const result = buildTrendWithBand(pts, 50);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
    result!.forEach((p) => {
      expect(p.upper).toBeGreaterThanOrEqual(p.y);
      expect(p.lower).toBeLessThanOrEqual(p.y);
    });
  });

  it('clamps trend/band to padded y-range', () => {
    const pts: InputPoint[] = [
      { ...point({}), x: 0.0, speed: 5 },
      { ...point({}), x: 0.5, speed: 5 },
      { ...point({}), x: 1.0, speed: 5 },
    ];
    const result = buildTrendWithBand(pts, 10);
    expect(result).not.toBeNull();
    // All speeds identical → padding = 0.5 fallback → range clamped to [4.5, 5.5]
    result!.forEach((p) => {
      expect(p.y).toBeLessThanOrEqual(5.5);
      expect(p.y).toBeGreaterThanOrEqual(4.5);
      expect(p.upper).toBeLessThanOrEqual(5.5);
      expect(p.lower).toBeGreaterThanOrEqual(4.5);
    });
  });
});
