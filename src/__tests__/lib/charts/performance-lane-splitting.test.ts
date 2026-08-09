/**
 * Tests for unified-performance lane preparation.
 *
 * Pure functions - no React, no Victory. We stub a minimal
 * PerformanceDataPoint shape with just the fields the splitter reads.
 */

import {
  buildLaneStats,
  splitIntoLanes,
  type ChartPoint,
} from '@/features/routes/lib/unifiedPerformanceData';
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

  it('locates the shortest-time point as the best', () => {
    const points: ChartPoint[] = [
      { ...makePoint({ speed: 3, sectionTime: 600 }), x: 0.1 },
      { ...makePoint({ speed: 7, sectionTime: 300 }), x: 0.2 },
      { ...makePoint({ speed: 5, sectionTime: 450 }), x: 0.3 },
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

/**
 * Golden baseline for the lane split the unified performance chart consumes.
 *
 * The fixture is a season of traversals in both directions, with excluded
 * efforts, laps and a personal best, so a change to lane ordering, domain
 * padding or best-point selection shows up as a diff.
 */
describe('lane preparation golden', () => {
  const SEASON: PerformanceDataPoint[] = [
    {
      id: 'e1',
      activityId: 'a1',
      activityName: 'Winter base',
      speed: 5.4,
      sectionTime: 812,
      sectionDistance: 4380,
      date: new Date('2025-01-06T08:12:00Z'),
      direction: 'same',
      lapNumber: 1,
      totalLaps: 1,
    },
    {
      id: 'e2',
      activityId: 'a2',
      activityName: 'Club run',
      speed: 6.1,
      sectionTime: 718,
      sectionDistance: 4380,
      date: new Date('2025-02-11T17:03:00Z'),
      direction: 'same',
      matchPercentage: 96,
    },
    {
      id: 'e3',
      activityId: 'a3',
      activityName: 'Reverse recce',
      speed: 5.0,
      sectionTime: 876,
      sectionDistance: 4380,
      date: new Date('2025-03-02T09:41:00Z'),
      direction: 'reverse',
    },
    {
      id: 'e4',
      activityId: 'a4',
      activityName: 'Threshold day',
      speed: 6.9,
      sectionTime: 635,
      sectionDistance: 4380,
      date: new Date('2025-04-19T06:55:00Z'),
      direction: 'same',
      isBest: true,
    },
    {
      id: 'e5',
      activityId: 'a5',
      activityName: 'Easy spin',
      speed: 4.2,
      sectionTime: 1043,
      sectionDistance: 4380,
      date: new Date('2025-05-24T15:20:00Z'),
      direction: 'same',
      isExcluded: true,
    },
    {
      id: 'e6',
      activityId: 'a6',
      activityName: 'Reverse repeat',
      speed: 5.8,
      sectionTime: 755,
      sectionDistance: 4380,
      date: new Date('2025-06-08T07:30:00Z'),
      direction: 'reverse',
      lapNumber: 2,
      totalLaps: 3,
    },
    {
      id: 'e7',
      activityId: 'a7',
      activityName: 'Autumn tempo',
      speed: 6.4,
      sectionTime: 684,
      sectionDistance: 4380,
      date: new Date('2025-09-14T10:05:00Z'),
      direction: 'same',
    },
    {
      id: 'e8',
      activityId: 'a8',
      activityName: 'Reverse tempo',
      speed: 6.2,
      sectionTime: 706,
      sectionDistance: 4380,
      date: new Date('2025-10-27T16:48:00Z'),
      direction: 'reverse',
    },
  ];

  // Evenly spaced normalised positions, the same gap-compressed shape the
  // chart uses, without pulling the axis builder into the fixture.
  const spread = (date: Date) => {
    const index = SEASON.findIndex((p) => p.date.getTime() === date.getTime());
    return index < 0 ? 0.5 : index / (SEASON.length - 1);
  };

  function summarise(lane: ReturnType<typeof buildLaneStats>) {
    return {
      originalIndices: lane.originalIndices,
      bestIndex: lane.bestIndex,
      currentIndex: lane.currentIndex,
      minSpeed: lane.minSpeed,
      maxSpeed: lane.maxSpeed,
      points: lane.points.map((p) => ({
        id: p.id,
        x: p.x,
        speed: p.speed,
        sectionTime: p.sectionTime,
        direction: p.direction,
        isExcluded: p.isExcluded ?? false,
        isBest: p.isBest ?? false,
      })),
    };
  }

  it('matches the golden with no highlighted point', () => {
    const { forwardLane, reverseLane } = splitIntoLanes(SEASON, spread, undefined);

    expect({
      forwardLane: summarise(forwardLane),
      reverseLane: summarise(reverseLane),
    }).toMatchSnapshot();
  });

  it('matches the golden with a highlighted reverse traversal', () => {
    const { forwardLane, reverseLane } = splitIntoLanes(SEASON, spread, 5);

    expect({
      forwardLane: summarise(forwardLane),
      reverseLane: summarise(reverseLane),
    }).toMatchSnapshot();
  });
});
