/**
 * Each attempt on the scatter carries the marks the engine's flags give it,
 * and the marks combine: this activity holding the record carries both the
 * reticle and the record ring.
 */

import {
  TAP_REACH_PX,
  clampToRange,
  placeRecordStaircase,
  scatterMarkFor,
  scatterRange,
  scatterStanding,
} from '@/features/routes/lib/scatterMarks';
import { nearestScatterPointIndex } from '@/features/routes/lib/scatterData';
import type { PerformanceDataPoint } from '@/types';
import type { FfiRecordStep } from 'veloqrs';

function attempt(overrides: Partial<PerformanceDataPoint>): PerformanceDataPoint {
  return {
    id: 'lap-a',
    activityId: 'a',
    speed: 5,
    date: new Date('2026-03-01'),
    activityName: 'Harbour loop',
    direction: 'same',
    ...overrides,
  };
}

const CTX = { highlightedActivityId: 'mine', selected: null, recordsSettled: true };

describe('scatterMarkFor', () => {
  it('gives this activity holding the record the reticle and the record ring', () => {
    const mark = scatterMarkFor(attempt({ activityId: 'mine', isBest: true }), CTX);
    expect(mark).toEqual({ kind: 'dot', record: true, thisActivity: true, selected: false });
  });

  it('gives a plain this-activity point the reticle only', () => {
    const mark = scatterMarkFor(attempt({ activityId: 'mine' }), CTX);
    expect(mark.thisActivity).toBe(true);
    expect(mark.record).toBe(false);
  });

  it('gives the record held by another activity the ring and no reticle', () => {
    const mark = scatterMarkFor(attempt({ activityId: 'other', isBest: true }), CTX);
    expect(mark).toEqual({ kind: 'dot', record: true, thisActivity: false, selected: false });
  });

  it('holds the record ring back until the time streams are read', () => {
    const mark = scatterMarkFor(attempt({ isBest: true }), { ...CTX, recordsSettled: false });
    expect(mark.record).toBe(false);
  });

  it('never rings an excluded attempt', () => {
    const mark = scatterMarkFor(attempt({ isBest: true, isExcluded: true }), CTX);
    expect(mark).toMatchObject({ kind: 'excluded', record: false });
  });

  it('puts a fast attempt past the range at the top edge and a slow one at the bottom', () => {
    expect(scatterMarkFor(attempt({ offScale: 'fast' }), CTX).kind).toBe('offScaleTop');
    expect(scatterMarkFor(attempt({ offScale: 'slow' }), CTX).kind).toBe('offScaleBottom');
  });

  it('flags an excluded attempt past the range at the edge as well', () => {
    expect(scatterMarkFor(attempt({ offScale: 'slow', isExcluded: true }), CTX).kind).toBe(
      'offScaleBottom'
    );
  });

  it('never puts the highlighted point off the scale', () => {
    const mark = scatterMarkFor(attempt({ activityId: 'mine', offScale: 'slow' }), CTX);
    expect(mark.kind).toBe('dot');
    expect(mark.thisActivity).toBe(true);
  });

  it('selects by lap and activity together', () => {
    const selected = { id: 'lap-a', activityId: 'a' };
    expect(scatterMarkFor(attempt({}), { ...CTX, selected }).selected).toBe(true);
    expect(scatterMarkFor(attempt({ id: 'lap-b' }), { ...CTX, selected }).selected).toBe(false);
  });
});

describe('scatterRange', () => {
  it('takes the engine focus range and ignores the drawn extent', () => {
    expect(scatterRange({ low: 4, high: 6, slowCount: 1, fastCount: 0 }, [1, 5, 20])).toEqual([
      4, 6,
    ]);
  });

  it('pads the drawn extent when the read gives no focus', () => {
    const range = scatterRange(undefined, [4, 6]);
    expect(range?.[0]).toBeCloseTo(3.76);
    expect(range?.[1]).toBeCloseTo(6.24);
  });

  it('gives a flat set a span and an empty set none', () => {
    const flat = scatterRange(undefined, [5, 5]);
    expect(flat?.[0]).toBeLessThan(5);
    expect(flat?.[1]).toBeGreaterThan(5);
    expect(scatterRange(undefined, [])).toBeNull();
  });

  it('holds a value past the range at its edge', () => {
    expect(clampToRange(30, [4, 6])).toBe(6);
    expect(clampToRange(1, [4, 6])).toBe(4);
    expect(clampToRange(5, [4, 6])).toBe(5);
  });
});

function step(overrides: Partial<FfiRecordStep>): FfiRecordStep {
  return {
    activityId: 'a',
    lapId: 'lap-a',
    activityDate: Date.parse('2026-03-01') / 1000,
    sectionTime: 600,
    speed: 5,
    ...overrides,
  };
}

describe('placeRecordStaircase', () => {
  const dates = { first: new Date('2026-02-01'), last: new Date('2026-04-01') };

  it('carries the level of a record set before the range in from the left edge', () => {
    const placed = placeRecordStaircase(
      [
        step({ activityDate: Date.parse('2025-06-01') / 1000, speed: 4.8 }),
        step({ activityDate: Date.parse('2026-04-01') / 1000, speed: 5.2 }),
      ],
      dates,
      'speed',
      [4, 6]
    );
    expect(placed.carriedIn).toBe(4.8);
    expect(placed.steps).toEqual([{ x: 0.98, value: 5.2 }]);
  });

  it('places a step on the time axis by its time and holds it inside the range', () => {
    const placed = placeRecordStaircase(
      [step({ activityDate: Date.parse('2026-02-01') / 1000, sectionTime: 900 })],
      dates,
      'time',
      [500, 700]
    );
    expect(placed.carriedIn).toBeNull();
    expect(placed.steps).toEqual([{ x: 0.02, value: 700 }]);
  });

  it('draws nothing with no progression', () => {
    expect(placeRecordStaircase([], dates, 'speed', [4, 6])).toEqual({
      carriedIn: null,
      steps: [],
    });
  });
});

describe('scatterStanding', () => {
  it('reads a new record with its gain over the record before', () => {
    const standing = scatterStanding(
      attempt({ isBest: true, recordGapSpeed: 0, recordGapSecs: 0 }),
      [step({ lapId: 'lap-a', improvementSpeed: 0.08, improvementSecs: 9 })],
      'speed'
    );
    expect(standing).toEqual({ kind: 'newRecord', gain: 0.08 });
  });

  it('reads the first record ever set as a new record with no gain', () => {
    const standing = scatterStanding(
      attempt({ isBest: true, recordGapSecs: 0 }),
      [step({ lapId: 'lap-a' })],
      'time'
    );
    expect(standing).toEqual({ kind: 'newRecord', gain: null });
  });

  it('reads a slower attempt as off the record by the engine gap on the drawn axis', () => {
    const point = attempt({ recordGapSecs: 12, recordGapSpeed: 0.3 });
    expect(scatterStanding(point, [], 'time')).toEqual({ kind: 'offRecord', gap: 12 });
    expect(scatterStanding(point, [], 'speed')).toEqual({ kind: 'offRecord', gap: 0.3 });
  });

  it('says nothing where the engine gives no gap', () => {
    expect(scatterStanding(attempt({}), [], 'speed')).toBeNull();
  });
});

describe('nearestScatterPointIndex within reach', () => {
  const box = { width: 300, height: 200, radius: TAP_REACH_PX };
  // Two points at (60, 100) and (240, 100) in pixels, on a domain of 0 to 10.
  const points = [
    { x: 0.2, y: 5 },
    { x: 0.8, y: 5 },
  ];

  it('selects nothing for a tap 30 px from every point', () => {
    expect(nearestScatterPointIndex(points, { x: 0.3, y: 0.5 }, [0, 10], box)).toBe(-1);
  });

  it('selects the nearest point for a tap 20 px from it', () => {
    expect(nearestScatterPointIndex(points, { x: 0.8, y: 0.6 }, [0, 10], box)).toBe(1);
  });

  it('reaches a point past the domain at the edge it is drawn on', () => {
    const past = [{ x: 0.5, y: 40 }];
    expect(nearestScatterPointIndex(past, { x: 0.5, y: 0.02 }, [0, 10], box)).toBe(0);
  });
});
