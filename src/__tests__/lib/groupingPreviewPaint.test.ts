/**
 * Scenario: the route-grouping preview groups the whole library at a chosen
 * setting and hands back groups of activity ids. The screen has to say what
 * that would do to the routes the athlete already has, without a second query.
 *
 * Expected behaviour: the payload joins against the route summaries on the
 * representative ride, the largest previewed group is the one drawn opaque,
 * and a setting that would merge two of today's routes or drop one out of
 * every group says so.
 */

import {
  GROUPING_DEFAULTS,
  GROUPING_PARAM_RANGES,
  paintPreview,
  parseGroupingInput,
} from '@/features/routes/lib/groupingParams';

const routes = [
  { groupId: 'g1', representativeId: 'a1' },
  { groupId: 'g2', representativeId: 'a2' },
  { groupId: 'g3', representativeId: 'a3' },
];

describe('paintPreview', () => {
  it('marks the largest previewed group, and only it', () => {
    const diff = paintPreview(routes, [
      { key: 'p1', activityIds: ['a1', 'a9', 'a8'] },
      { key: 'p2', activityIds: ['a2'] },
      { key: 'p3', activityIds: ['a3', 'a7'] },
    ]);

    expect(diff.routes.map((r) => r.isLargest)).toEqual([true, false, false]);
    expect(diff.routes[0].previewSize).toBe(3);
    expect(diff.previewGroupCount).toBe(3);
  });

  it('names the two routes a setting would merge into one', () => {
    const diff = paintPreview(routes, [
      { key: 'p1', activityIds: ['a1', 'a2'] },
      { key: 'p2', activityIds: ['a3'] },
    ]);

    expect(diff.mergedCount).toBe(2);
    expect(diff.routes.map((r) => r.mergesWithAnother)).toEqual([true, true, false]);
  });

  it('reads a route whose ride falls out of every group as dropped', () => {
    const diff = paintPreview(routes, [{ key: 'p1', activityIds: ['a1', 'a2'] }]);

    expect(diff.droppedCount).toBe(1);
    expect(diff.routes[2]).toEqual({
      groupId: 'g3',
      previewKey: null,
      previewSize: 0,
      isLargest: false,
      mergesWithAnother: false,
    });
  });

  it('reads an empty payload as every route dropped, not as a crash', () => {
    const diff = paintPreview(routes, []);

    expect(diff.previewGroupCount).toBe(0);
    expect(diff.droppedCount).toBe(3);
    expect(diff.routes.every((r) => !r.isLargest)).toBe(true);
  });

  it('has nothing to paint when the athlete has no routes yet', () => {
    const diff = paintPreview([], [{ key: 'p1', activityIds: ['a1'] }]);

    expect(diff.routes).toEqual([]);
    expect(diff.mergedCount).toBe(0);
    expect(diff.droppedCount).toBe(0);
  });

  it('breaks a tie for largest on the first group, so the paint does not flicker', () => {
    const first = paintPreview(routes, [
      { key: 'p1', activityIds: ['a1', 'a9'] },
      { key: 'p2', activityIds: ['a2', 'a8'] },
    ]);

    expect(first.routes[0].isLargest).toBe(true);
    expect(first.routes[1].isLargest).toBe(false);
  });
});

describe('parseGroupingInput', () => {
  it('takes a whole number, and a comma decimal', () => {
    expect(parseGroupingInput('endpointThreshold', ' 400 ')).toBe(400);
    expect(parseGroupingInput('endpointThreshold', '400,6')).toBe(401);
  });

  it('refuses a match percentage that can never be met', () => {
    expect(parseGroupingInput('minMatchPercentage', '101')).toBeNull();
    expect(parseGroupingInput('minMatchPercentage', '100')).toBe(100);
  });

  it('refuses zero, a negative and a word', () => {
    expect(parseGroupingInput('endpointThreshold', '0')).toBeNull();
    expect(parseGroupingInput('endpointThreshold', '-5')).toBeNull();
    expect(parseGroupingInput('endpointThreshold', 'close')).toBeNull();
  });
});

describe('the ranges the sliders cover', () => {
  it('opens on a value inside both of them', () => {
    for (const key of ['minMatchPercentage', 'endpointThreshold'] as const) {
      const range = GROUPING_PARAM_RANGES[key];
      expect(GROUPING_DEFAULTS[key]).toBeGreaterThanOrEqual(range.min);
      expect(GROUPING_DEFAULTS[key]).toBeLessThanOrEqual(range.max);
    }
  });
});
