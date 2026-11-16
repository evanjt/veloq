/**
 * Scenario: the section page places the engine's performance read for its
 * charts and tables.
 *
 * Expected behaviour: a range and a sport become the engine's ask, a direction
 * keeps only its own laps oldest first, the histogram's bins are the engine's,
 * a direction with no stats has no row, and a delta curve reads the engine's
 * floats with a gap where the lap does not cover.
 */

import {
  askOf,
  binsOf,
  candidatesByOverlap,
  deltaCurvesOf,
  directionsOf,
  pointsOf,
  statsOf,
} from '../../../web/connect/sectionDetail';
import { singles } from '../__shared__/connectDemoBase';

const point = (lapId: string, direction: string, activityDate: number, speed = 5) => ({
  lapId,
  activityId: lapId,
  activityName: lapId,
  activityDate,
  speed,
  sectionTime: 100,
  direction,
  isBest: false,
  recordGapSecs: null,
});

const PERFORMANCE = {
  chartData: {
    hasReverseRuns: true,
    points: [point('c', 'forward', 30), point('a', 'forward', 10), point('r', 'reverse', 20)],
  },
  histograms: {
    forward: { startSecs: 100, binWidthSecs: 10, counts: [2, 0, 1] },
    reverse: null,
  },
  performances: {
    forwardStats: { avgTime: 120, lastActivity: 30, count: 2, avgSpeed: 4, outsideBandCount: 1 },
    reverseStats: null,
    bestForwardRecord: { bestForwardTime: 98 },
    bestReverseRecord: null,
  },
  bestForwardIsRecord: true,
  bestReverseIsRecord: false,
  curves: {
    gridStepM: 25,
    forward: {
      laps: [
        { activityId: 'b', startIndex: 7, activityDate: 20, deltaSecs: singles([0, 1.5, NaN]) },
        { activityId: 'a', startIndex: 3, activityDate: 10, deltaSecs: singles([0, -2]) },
      ],
    },
    reverse: null,
  },
} as never;

describe('the performance ask', () => {
  it('names the range in days and the sport, and leaves the sport to the engine when none is chosen', () => {
    expect(askOf('s1', '90d', 'Ride')).toEqual({
      id: 's1',
      timeRangeDays: 90,
      sportFilter: 'Ride',
      highlightActivityId: null,
    });
    expect(askOf('s1', 'all', null).timeRangeDays).toBeGreaterThan(20 * 365);
    expect(askOf('s1', '1y', null).sportFilter).toBeNull();
  });
});

describe('the directions', () => {
  it('offers reverse only once a reverse run exists', () => {
    expect(directionsOf(PERFORMANCE)).toEqual(['forward', 'reverse']);
    const only = { chartData: { hasReverseRuns: false, points: [] } } as never;
    expect(directionsOf(only)).toEqual(['forward']);
  });

  it('keeps the laps of one direction, oldest first', () => {
    expect(pointsOf(PERFORMANCE, 'forward').map((p) => p.lapId)).toEqual(['a', 'c']);
    expect(pointsOf(PERFORMANCE, 'reverse').map((p) => p.lapId)).toEqual(['r']);
  });

  it('has the engine histogram bins for a direction and none for one without', () => {
    expect(binsOf(PERFORMANCE, 'forward')).toEqual([
      { low: 100, high: 110, count: 2 },
      { low: 110, high: 120, count: 0 },
      { low: 120, high: 130, count: 1 },
    ]);
    expect(binsOf(PERFORMANCE, 'reverse')).toEqual([]);
  });

  it('has a stats row only for a direction the engine has stats for', () => {
    expect(statsOf(PERFORMANCE)).toEqual([
      {
        direction: 'forward',
        count: 2,
        avgTime: 120,
        avgSpeed: 4,
        last: 30,
        best: 98,
        record: true,
        outsideBand: 1,
      },
    ]);
  });
});

describe('the ahead or behind curves', () => {
  it('reads each lap oldest first with a gap where the engine has none', () => {
    const set = deltaCurvesOf(PERFORMANCE, 'forward');
    expect(set?.metres).toEqual([0, 25, 50]);
    expect(set?.curves.map((curve) => [curve.key, curve.values])).toEqual([
      ['a:3', [0, -2]],
      ['b:7', [0, 1.5, null]],
    ]);
  });

  it('is none for a direction with no curves, and while the engine has none', () => {
    expect(deltaCurvesOf(PERFORMANCE, 'reverse')).toBeNull();
    expect(deltaCurvesOf({ curves: null } as never, 'forward')).toBeNull();
  });
});

describe('the merge candidates', () => {
  it('lists the most shared ground first', () => {
    const list = [
      { sectionId: 'x', overlapPct: 40 },
      { sectionId: 'y', overlapPct: 90 },
    ] as never[];
    expect(candidatesByOverlap(list).map((c) => c.sectionId)).toEqual(['y', 'x']);
  });
});
