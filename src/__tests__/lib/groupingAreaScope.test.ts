/**
 * Scenario: the grouping preview regroups the whole library, but the map shows
 * one riding area. A route pair that merges in another area moves the library
 * count and must not read as a silent map.
 *
 * Expected behaviour: the summary is scoped to the selected area, a change that
 * lands only in other areas is named by area, and a merge inside the area flags
 * both routes.
 */

import { paintPreview } from '@/features/routes/lib/groupingParams';
import { scopeGroupingDiff } from '@/features/routes/lib/groupingAreaScope';

const bounds = (lat: number, lng: number) => ({
  minLat: lat - 0.01,
  maxLat: lat + 0.01,
  minLng: lng - 0.01,
  maxLng: lng + 0.01,
});

const areas = [
  { binKey: 'a', lat: 46.5, lng: 6.6 },
  { binKey: 'b', lat: 47.4, lng: 8.5 },
];

const routes = [
  { groupId: 'g1', representativeId: 'a1', bounds: bounds(46.5, 6.6) },
  { groupId: 'g2', representativeId: 'a2', bounds: bounds(46.51, 6.61) },
  { groupId: 'g3', representativeId: 'a3', bounds: bounds(47.4, 8.5) },
  { groupId: 'g4', representativeId: 'a4', bounds: bounds(47.41, 8.51) },
];

describe('scopeGroupingDiff', () => {
  it('reports no change in the area when the merge is in another area, and names that area', () => {
    const diff = paintPreview(routes, [
      { key: 'p1', activityIds: ['a1'] },
      { key: 'p2', activityIds: ['a2'] },
      { key: 'p3', activityIds: ['a3', 'a4'] },
    ]);

    const scoped = scopeGroupingDiff(routes, diff, areas, 'a');

    expect(scoped.inArea).toEqual({
      routeCount: 2,
      mergedCount: 0,
      droppedCount: 0,
      splitCount: 0,
    });
    expect(scoped.elsewhere).toEqual([
      { binKey: 'b', mergedCount: 2, droppedCount: 0, splitCount: 0 },
    ]);
    expect(scoped.changedRouteIds.size).toBe(0);
  });

  it('flags both routes of a merge inside the area', () => {
    const diff = paintPreview(routes, [
      { key: 'p1', activityIds: ['a1', 'a2'] },
      { key: 'p3', activityIds: ['a3'] },
      { key: 'p4', activityIds: ['a4'] },
    ]);

    const scoped = scopeGroupingDiff(routes, diff, areas, 'a');

    expect(scoped.inArea.mergedCount).toBe(2);
    expect([...scoped.changedRouteIds].sort()).toEqual(['g1', 'g2']);
    expect(scoped.elsewhere).toEqual([]);
  });

  it('counts a dropped route against its own area', () => {
    const diff = paintPreview(routes, [
      { key: 'p1', activityIds: ['a1', 'a2'] },
      { key: 'p3', activityIds: ['a3'] },
    ]);

    const scoped = scopeGroupingDiff(routes, diff, areas, 'b');

    expect(scoped.inArea).toEqual({
      routeCount: 2,
      mergedCount: 0,
      droppedCount: 1,
      splitCount: 0,
    });
    expect(scoped.elsewhere).toEqual([
      { binKey: 'a', mergedCount: 2, droppedCount: 0, splitCount: 0 },
    ]);
  });

  it('puts every route in the scope when the library has no areas', () => {
    const diff = paintPreview(routes, [{ key: 'p1', activityIds: ['a1', 'a2'] }]);

    const scoped = scopeGroupingDiff(routes, diff, [], null);

    expect(scoped.inArea.routeCount).toBe(4);
    expect(scoped.elsewhere).toEqual([]);
  });

  it('leaves a route with no track box out of every area but keeps it in the library', () => {
    const boxless = [...routes, { groupId: 'g5', representativeId: 'a5' }];
    const diff = paintPreview(boxless, [{ key: 'p1', activityIds: ['a5'] }]);

    const scoped = scopeGroupingDiff(boxless, diff, areas, 'a');

    expect(scoped.inArea.routeCount).toBe(2);
    expect(scoped.elsewhere.map((e) => e.binKey)).toEqual(['b']);
  });

  it('counts a route whose rides land in two preview groups as split, in its own area', () => {
    const diff = paintPreview(
      routes,
      [
        { key: 'p1', activityIds: ['a1'] },
        { key: 'p1b', activityIds: ['a1b'] },
        { key: 'p2', activityIds: ['a2'] },
        { key: 'p3', activityIds: ['a3'] },
        { key: 'p4', activityIds: ['a4'] },
      ],
      [
        { groupId: 'g1', previewGroups: 2 },
        { groupId: 'g2', previewGroups: 1 },
        { groupId: 'g3', previewGroups: 0 },
        { groupId: 'g4', previewGroups: 2 },
      ]
    );

    const scoped = scopeGroupingDiff(routes, diff, areas, 'a');

    expect(scoped.inArea).toEqual({
      routeCount: 2,
      mergedCount: 0,
      droppedCount: 0,
      splitCount: 1,
    });
    expect([...scoped.changedRouteIds]).toEqual(['g1']);
    expect(scoped.elsewhere).toEqual([
      { binKey: 'b', mergedCount: 0, droppedCount: 0, splitCount: 1 },
    ]);
  });

  it('counts no split when the engine reported no spreads', () => {
    const diff = paintPreview(routes, [{ key: 'p1', activityIds: ['a1'] }]);
    expect(diff.splitCount).toBe(0);
  });
});
