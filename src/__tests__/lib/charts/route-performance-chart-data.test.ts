/**
 * Tests for scatter-chart data-prep helpers.
 */

import { splitAndPositionChartData } from '@/features/routes/lib/scatterData';
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
  it('scales each direction from its own speeds and times', () => {
    const result = splitAndPositionChartData([
      point({ date: new Date('2024-01-01'), speed: 4, sectionTime: 250 }),
      point({ date: new Date('2024-02-01'), speed: 4.2, sectionTime: 240 }),
      point({ date: new Date('2024-03-01'), speed: 12, sectionTime: 85, direction: 'reverse' }),
      point({ date: new Date('2024-04-01'), speed: 13, sectionTime: 80, direction: 'reverse' }),
    ]);

    expect(result.domains.forward?.minSpeed).toBeCloseTo(3.97);
    expect(result.domains.forward?.maxSpeed).toBeCloseTo(4.23);
    expect(result.domains.forward?.minTime).toBeCloseTo(238.5);
    expect(result.domains.forward?.maxTime).toBeCloseTo(251.5);
    expect(result.domains.reverse?.minSpeed).toBeCloseTo(11.85);
    expect(result.domains.reverse?.maxSpeed).toBeCloseTo(13.15);
    expect(result.domains.reverse?.minTime).toBeCloseTo(79.25);
    expect(result.domains.reverse?.maxTime).toBeCloseTo(85.75);
  });

  it('has no reverse domain when only forward attempts exist', () => {
    const result = splitAndPositionChartData([point({ speed: 4, sectionTime: 250 })]);
    expect(result.domains.forward).toBeTruthy();
    expect(result.domains.reverse).toBeNull();
  });

  it('returns EMPTY_SPLIT for empty input', () => {
    const result = splitAndPositionChartData([]);
    expect(result.allPoints).toEqual([]);
    expect(result.forwardPoints).toEqual([]);
    expect(result.reversePoints).toEqual([]);
  });

  it('returns EMPTY_SPLIT when no points have valid dates', () => {
    const result = splitAndPositionChartData([
      // @ts-expect-error - deliberately invalid date
      point({ date: 'not-a-date' }),
      point({ date: new Date('not a date') }),
    ]);
    expect(result.allPoints).toEqual([]);
  });

  it('places a single point with normalized x ~0.02', () => {
    const result = splitAndPositionChartData([point({ speed: 3, sectionTime: 300 })]);
    expect(result.allPoints).toHaveLength(1);
    expect(result.forwardPoints).toHaveLength(1);
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

  it('carries the engine record flag through on the point it was set on', () => {
    const pts: InputPoint[] = [
      point({ activityId: 'fast', date: new Date('2024-01-01'), speed: 7, sectionTime: 300 }),
      point({
        activityId: 'record',
        date: new Date('2024-02-01'),
        speed: 6,
        sectionTime: 290,
        isBest: true,
      }),
    ];
    const result = splitAndPositionChartData(pts);
    expect(result.allPoints.filter((p) => p.isBest).map((p) => p.activityId)).toEqual(['record']);
  });

  /**
   * Scenario: 20 forward attempts near 8 m/s and one GPS glitch at 20 m/s
   * the athlete excluded, shown with the eye toggle so it can be reviewed.
   *
   * Expected behaviour: the glitch is drawn and tappable, but the direction's
   * count is the one without it, so a visibility
   * toggle never changes the chart's answer.
   */
  it('leaves an excluded attempt out of the points the count reads', () => {
    const attempts = Array.from({ length: 20 }, (_, i) =>
      point({
        activityId: `a${i}`,
        date: new Date(Date.UTC(2024, 0, 1 + i * 3)),
        speed: 8 + (i % 3) * 0.1,
        sectionTime: 100,
      })
    );
    const glitch = point({
      activityId: 'glitch',
      date: new Date(Date.UTC(2024, 1, 15)),
      speed: 20,
      sectionTime: 40,
      isExcluded: true,
    });
    const reverseGlitch = point({
      activityId: 'reverse-glitch',
      date: new Date(Date.UTC(2024, 1, 16)),
      speed: 20,
      direction: 'reverse',
      isExcluded: true,
    });

    const without = splitAndPositionChartData(attempts);
    const shown = splitAndPositionChartData([...attempts, glitch, reverseGlitch]);

    expect(shown.allPoints).toHaveLength(22);
    expect(shown.forwardPoints).toHaveLength(20);
    expect(shown.reversePoints).toHaveLength(0);
    expect(shown.forwardPoints.map((p) => p.activityId)).toEqual(
      without.forwardPoints.map((p) => p.activityId)
    );
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
    expect(result.domains.forward?.maxSpeed).toBeCloseTo(21.5, 4);
    expect(result.domains.forward?.minSpeed).toBeCloseTo(8.5, 4);
  });

  it('uses fallback padding of 0.5 when all speeds are identical', () => {
    const pts: InputPoint[] = [
      point({ date: new Date('2024-01-01'), speed: 5 }),
      point({ date: new Date('2024-02-01'), speed: 5 }),
    ];
    const result = splitAndPositionChartData(pts);
    // max - min = 0, so padding = 0.5 (from `|| 0.5`)
    expect(result.domains.forward?.maxSpeed).toBeCloseTo(5.5, 4);
    expect(result.domains.forward?.minSpeed).toBeCloseTo(4.5, 4);
  });

  it('floors minSpeed at 0 when padding would push it negative', () => {
    // Zero speed with small delta → 15% padding pushes min to -0.015, clamped to 0
    const pts: InputPoint[] = [
      point({ date: new Date('2024-01-01'), speed: 0 }),
      point({ date: new Date('2024-02-01'), speed: 0.1 }),
    ];
    const result = splitAndPositionChartData(pts);
    expect(result.domains.forward?.minSpeed).toBe(0);
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
