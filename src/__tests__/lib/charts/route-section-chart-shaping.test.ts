/**
 * Tests for the shaping half of the route and section chart hooks, now that
 * the engine call and the shaping live apart.
 */

import {
  buildRouteChartShape,
  enrichWithDirectionBests,
  type RouteSignatureMap,
} from '@/features/routes/lib/routeChartData';
import {
  buildSectionChartShape,
  buildSectionChartStats,
  type SectionChartSource,
} from '@/features/routes/lib/sectionChartData';
import type { RoutePerformancePoint } from '@/features/routes/hooks/useRoutePerformances';

function performance(overrides: Partial<RoutePerformancePoint>): RoutePerformancePoint {
  return {
    activityId: 'a1',
    name: 'Morning ride',
    date: new Date('2026-01-02T08:00:00Z'),
    speed: 8,
    duration: 600,
    direction: 'same',
    matchPercentage: 95,
    ...overrides,
  } as RoutePerformancePoint;
}

describe('buildRouteChartShape', () => {
  it('returns an empty shape for no performances', () => {
    const shape = buildRouteChartShape([], null, {});
    expect(shape.chartData).toEqual([]);
    expect(shape.minSpeed).toBe(0);
    expect(shape.maxSpeed).toBe(1);
  });

  it('drops partial traversals and non-finite speeds', () => {
    const shape = buildRouteChartShape(
      [
        performance({ activityId: 'ok', speed: 8 }),
        performance({ activityId: 'partial', direction: 'partial' }),
        performance({ activityId: 'nan', speed: Number.NaN }),
      ],
      null,
      {}
    );
    expect(shape.chartData.map((p) => p.activityId)).toEqual(['ok']);
  });

  it('indexes surviving points from zero after the filter', () => {
    const shape = buildRouteChartShape(
      [
        performance({ activityId: 'partial', direction: 'partial' }),
        performance({ activityId: 'a', speed: 7 }),
        performance({ activityId: 'b', speed: 9 }),
      ],
      null,
      {}
    );
    expect(shape.chartData.map((p) => p.x)).toEqual([0, 1]);
  });

  it('pads the speed axis by 15 percent and never goes below zero', () => {
    const shape = buildRouteChartShape(
      [performance({ activityId: 'a', speed: 4 }), performance({ activityId: 'b', speed: 8 })],
      null,
      {}
    );
    // Range 4, so padding is 0.6.
    expect(shape.minSpeed).toBeCloseTo(3.4, 6);
    expect(shape.maxSpeed).toBeCloseTo(8.6, 6);
  });

  it('falls back to a half-unit pad when every speed matches', () => {
    const shape = buildRouteChartShape([performance({ speed: 5 })], null, {});
    expect(shape.minSpeed).toBeCloseTo(4.5, 6);
    expect(shape.maxSpeed).toBeCloseTo(5.5, 6);
  });

  it('prefers the supplied best performance for bestIndex', () => {
    const shape = buildRouteChartShape(
      [
        performance({ activityId: 'a', duration: 500 }),
        performance({ activityId: 'b', duration: 900 }),
      ],
      performance({ activityId: 'b' }),
      {}
    );
    expect(shape.bestIndex).toBe(1);
  });

  it('falls back to the shortest duration when no best is supplied', () => {
    const shape = buildRouteChartShape(
      [
        performance({ activityId: 'a', duration: 900 }),
        performance({ activityId: 'b', duration: 500 }),
      ],
      null,
      {}
    );
    expect(shape.bestIndex).toBe(1);
  });

  it('falls back to index zero when the best performance is not in the set', () => {
    const shape = buildRouteChartShape(
      [performance({ activityId: 'a' })],
      performance({ activityId: 'missing' }),
      {}
    );
    expect(shape.bestIndex).toBe(0);
  });

  it('attaches the decoded signature trace to its own point', () => {
    const signatures: RouteSignatureMap = {
      a: { points: [{ lat: 1, lng: 2 }] },
    };
    const shape = buildRouteChartShape(
      [performance({ activityId: 'a' }), performance({ activityId: 'b' })],
      null,
      signatures
    );
    expect(shape.chartData[0].lapPoints).toEqual([{ lat: 1, lng: 2 }]);
    expect(shape.chartData[1].lapPoints).toBeUndefined();
  });

  it('reports reverse runs when any point runs the other way', () => {
    expect(buildRouteChartShape([performance({})], null, {}).hasReverseRuns).toBe(false);
    expect(
      buildRouteChartShape([performance({ direction: 'reverse' })], null, {}).hasReverseRuns
    ).toBe(true);
  });
});

describe('enrichWithDirectionBests', () => {
  it('keeps an empty list empty', () => {
    expect(enrichWithDirectionBests([])).toEqual([]);
  });

  it('ranks each direction against its own best', () => {
    const shape = buildRouteChartShape(
      [
        performance({ activityId: 'f1', duration: 600, speed: 8, direction: 'same' }),
        performance({ activityId: 'f2', duration: 500, speed: 9, direction: 'same' }),
        performance({ activityId: 'r1', duration: 800, speed: 6, direction: 'reverse' }),
        performance({ activityId: 'r2', duration: 700, speed: 7, direction: 'reverse' }),
      ],
      null,
      {}
    );
    const enriched = enrichWithDirectionBests(shape.chartData);

    expect(enriched.map((p) => p.isBest)).toEqual([false, true, false, true]);
    expect(enriched[0].bestTime).toBe(500);
    expect(enriched[0].bestSpeed).toBe(9);
    expect(enriched[2].bestTime).toBe(700);
    expect(enriched[2].bestSpeed).toBe(7);
  });

  it('ignores zero-length efforts and clears their time', () => {
    const shape = buildRouteChartShape(
      [
        performance({ activityId: 'zero', duration: 0 }),
        performance({ activityId: 'real', duration: 400 }),
      ],
      null,
      {}
    );
    const enriched = enrichWithDirectionBests(shape.chartData);
    expect(enriched[0].sectionTime).toBeUndefined();
    expect(enriched[0].isBest).toBe(false);
    expect(enriched[1].isBest).toBe(true);
  });
});

function sectionSource(overrides: Partial<SectionChartSource> = {}): SectionChartSource {
  return {
    points: [
      {
        lapId: 'lap-1',
        activityId: 'a1',
        activityName: 'Climb',
        activityDate: 1767225600,
        direction: 'same',
        speed: 5,
        sectionTime: 300,
        sectionDistance: 1500,
        rank: 1,
      },
      {
        lapId: 'lap-2',
        activityId: 'a2',
        activityName: 'Climb again',
        activityDate: 1767312000,
        direction: 'reverse',
        speed: 7,
        sectionTime: 260,
        sectionDistance: 1500,
        rank: 2,
      },
    ],
    minSpeed: 5,
    maxSpeed: 7,
    bestIndex: 1,
    hasReverseRuns: true,
    bestActivityId: 'a2',
    bestTimeSecs: 260,
    bestPace: 7,
    averageTimeSecs: 280,
    lastActivityDate: 1767312000,
    totalActivities: 2,
    ...overrides,
  };
}

describe('buildSectionChartShape', () => {
  it('returns an empty shape when the engine had nothing', () => {
    const shape = buildSectionChartShape(null, undefined);
    expect(shape.chartData).toEqual([]);
    expect(shape.bestIndex).toBe(0);
  });

  it('indexes points and carries the engine best and direction flags through', () => {
    const shape = buildSectionChartShape(sectionSource(), undefined);
    expect(shape.chartData.map((p) => p.x)).toEqual([0, 1]);
    expect(shape.bestIndex).toBe(1);
    expect(shape.hasReverseRuns).toBe(true);
    expect(shape.chartData[1].direction).toBe('reverse');
  });

  it('pads the speed axis and clamps the floor at zero', () => {
    const shape = buildSectionChartShape(sectionSource({ minSpeed: 1, maxSpeed: 2 }), undefined);
    expect(shape.minSpeed).toBeCloseTo(0.85, 6);
    expect(shape.maxSpeed).toBeCloseTo(2.15, 6);

    const tiny = buildSectionChartShape(sectionSource({ minSpeed: 0.2, maxSpeed: 8 }), undefined);
    expect(tiny.minSpeed).toBe(0);
  });

  it('replaces non-finite engine speeds rather than poisoning the axis', () => {
    const source = sectionSource({ minSpeed: Number.NaN, maxSpeed: Number.NaN });
    source.points[0].speed = Number.NaN;
    const shape = buildSectionChartShape(source, undefined);
    expect(shape.chartData[0].speed).toBe(0);
    expect(Number.isFinite(shape.minSpeed)).toBe(true);
    expect(Number.isFinite(shape.maxSpeed)).toBe(true);
  });

  it('attaches the matching activity trace', () => {
    const traces = { a2: [{ lat: 1, lng: 2 }] };
    const shape = buildSectionChartShape(sectionSource(), traces);
    expect(shape.chartData[0].lapPoints).toBeUndefined();
    expect(shape.chartData[1].lapPoints).toBe(traces.a2);
  });
});

describe('buildSectionChartStats', () => {
  it('returns blank stats when the engine had nothing', () => {
    const stats = buildSectionChartStats(null);
    expect(stats.rankMap.size).toBe(0);
    expect(stats.bestActivityId).toBeNull();
    expect(stats.bestTimeValue).toBeUndefined();
  });

  it('keeps the first rank seen per activity', () => {
    const source = sectionSource();
    source.points.push({ ...source.points[0], lapId: 'lap-3', rank: 9 });
    const stats = buildSectionChartStats(source);
    expect(stats.rankMap.get('a1')).toBe(1);
  });

  it('collapses a non-finite stat to undefined', () => {
    const stats = buildSectionChartStats(sectionSource({ bestPace: Number.NaN }));
    expect(stats.bestPaceValue).toBeUndefined();
    expect(stats.bestTimeValue).toBe(260);
  });

  it('leaves an absent stat undefined rather than inventing one', () => {
    const stats = buildSectionChartStats(
      sectionSource({ averageTimeSecs: undefined, lastActivityDate: undefined })
    );
    expect(stats.averageTime).toBeUndefined();
    expect(stats.lastActivityDate).toBeUndefined();
  });

  it('renders the last activity date as an ISO string', () => {
    const stats = buildSectionChartStats(sectionSource());
    expect(stats.lastActivityDate).toBe(new Date(1767312000 * 1000).toISOString());
  });
});
