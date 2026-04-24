/**
 * Tests for unified-performance lane preparation.
 *
 * Pure functions — no React, no Victory. We stub a minimal
 * PerformanceDataPoint shape with just the fields the splitter reads.
 */

import {
  buildLaneStats,
  splitIntoLanes,
  type ChartPoint,
} from '@/lib/charts/unifiedPerformanceData';
import type { PerformanceDataPoint } from '@/types';

function makePoint(overrides: Partial<PerformanceDataPoint> = {}): PerformanceDataPoint {
  return {
    id: 'p',
    activityId: 'a1',
    activityName: 'Ride',
    speed: 5,
    date: new Date('2025-01-01T00:00:00Z'),
    direction: 'same',
    ...overrides,
  };
}

const linearX: (d: Date) => number = () => 0.5;

describe('buildLaneStats', () => {
  it('returns an empty-lane record when points is empty', () => {
    const lane = buildLaneStats([], [], undefined);
    expect(lane.points).toEqual([]);
    expect(lane.originalIndices).toEqual([]);
    expect(lane.bestIndex).toBe(-1);
    expect(lane.currentIndex).toBe(-1);
    expect(lane.minSpeed).toBe(0);
    expect(lane.maxSpeed).toBe(1);
  });

  it('locates the fastest point as the best', () => {
    const points: ChartPoint[] = [
      { ...makePoint({ speed: 3 }), x: 0.1 },
      { ...makePoint({ speed: 7 }), x: 0.2 },
      { ...makePoint({ speed: 5 }), x: 0.3 },
    ];
    const lane = buildLaneStats(points, [0, 1, 2], undefined);
    expect(lane.bestIndex).toBe(1);
  });

  it('pads min/max by 20%', () => {
    const points: ChartPoint[] = [
      { ...makePoint({ speed: 2 }), x: 0.1 },
      { ...makePoint({ speed: 12 }), x: 0.2 },
    ];
    const lane = buildLaneStats(points, [0, 1], undefined);
    // range = 10, padding = 2
    expect(lane.minSpeed).toBe(0);
    expect(lane.maxSpeed).toBe(14);
  });

  it('uses a 0.5 fallback padding when all speeds are equal', () => {
    const points: ChartPoint[] = [
      { ...makePoint({ speed: 5 }), x: 0.1 },
      { ...makePoint({ speed: 5 }), x: 0.2 },
    ];
    const lane = buildLaneStats(points, [0, 1], undefined);
    expect(lane.minSpeed).toBe(4.5);
    expect(lane.maxSpeed).toBe(5.5);
  });

  it('maps a global currentIndex to the lane-local index', () => {
    const points: ChartPoint[] = [
      { ...makePoint(), x: 0.1 },
      { ...makePoint(), x: 0.2 },
      { ...makePoint(), x: 0.3 },
    ];
    // The lane contains original indices [2, 5, 7]
    const lane = buildLaneStats(points, [2, 5, 7], 5);
    expect(lane.currentIndex).toBe(1);
  });

  it('returns -1 when the global currentIndex is outside this lane', () => {
    const points: ChartPoint[] = [
      { ...makePoint(), x: 0.1 },
      { ...makePoint(), x: 0.2 },
    ];
    const lane = buildLaneStats(points, [0, 2], 5);
    expect(lane.currentIndex).toBe(-1);
  });
});

describe('splitIntoLanes', () => {
  it('routes reverse points into the reverse lane and others into forward', () => {
    const chartData: PerformanceDataPoint[] = [
      makePoint({ id: 'a', direction: 'same' }),
      makePoint({ id: 'b', direction: 'reverse' }),
      makePoint({ id: 'c', direction: 'same' }),
      makePoint({ id: 'd', direction: 'reverse' }),
    ];
    const { forwardLane, reverseLane } = splitIntoLanes(chartData, linearX, undefined);
    expect(forwardLane.points.map((p) => p.id)).toEqual(['a', 'c']);
    expect(reverseLane.points.map((p) => p.id)).toEqual(['b', 'd']);
  });

  it('preserves original indices for later lookup', () => {
    const chartData: PerformanceDataPoint[] = [
      makePoint({ id: '0', direction: 'same' }),
      makePoint({ id: '1', direction: 'reverse' }),
      makePoint({ id: '2', direction: 'same' }),
      makePoint({ id: '3', direction: 'reverse' }),
      makePoint({ id: '4', direction: 'same' }),
    ];
    const { forwardLane, reverseLane } = splitIntoLanes(chartData, linearX, undefined);
    expect(forwardLane.originalIndices).toEqual([0, 2, 4]);
    expect(reverseLane.originalIndices).toEqual([1, 3]);
  });

  it('tags each lane point with an x value from the mapping', () => {
    const xByDate: Record<string, number> = {
      '2025-01-01T00:00:00.000Z': 0.1,
      '2025-01-02T00:00:00.000Z': 0.2,
    };
    const dateToX = (d: Date) => xByDate[d.toISOString()] ?? 0.5;
    const chartData: PerformanceDataPoint[] = [
      makePoint({ id: 'first', date: new Date('2025-01-01T00:00:00Z') }),
      makePoint({ id: 'second', date: new Date('2025-01-02T00:00:00Z') }),
    ];
    const { forwardLane } = splitIntoLanes(chartData, dateToX, undefined);
    expect(forwardLane.points.map((p) => p.x)).toEqual([0.1, 0.2]);
  });

  it('returns empty lanes for empty input', () => {
    const { forwardLane, reverseLane } = splitIntoLanes([], linearX, undefined);
    expect(forwardLane.points).toEqual([]);
    expect(reverseLane.points).toEqual([]);
  });
});
