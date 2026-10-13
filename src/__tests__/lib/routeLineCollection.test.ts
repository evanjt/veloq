/**
 * Scenario: the map read hands the route-line layer over as encoded polylines.
 *
 * Expected behaviour: each line becomes one LineString in `[lng, lat]` order, a route
 * with fewer than two points is left out because the iOS renderer crashes on one, a
 * route's colour follows from its id so a regroup that reorders the list keeps it, and the
 * same layer generation hands back the same collection object so MapLibre is not given new
 * data for an unchanged layer.
 */
import { routePalette, routePaletteIndex } from '@/theme/colors';
import { createRouteLineCache } from '@/features/maps/lib/routeLineCollection';

import { encodeTrack } from '../__shared__/trackBytes';

const line = (routeId: string, routeNumber: number | undefined, pts: [number, number][]) => ({
  routeId,
  routeNumber,
  name: `Loop ${routeId}`,
  activityCount: 2,
  distanceMeters: 5000,
  polyline: encodeTrack(pts.map(([latitude, longitude]) => ({ latitude, longitude }))),
});

describe('route line collection', () => {
  it('draws a route as a LineString in lng, lat order with its id, number and palette colour', () => {
    const cache = createRouteLineCache();
    const out = cache.collection({
      generation: 1,
      routes: [
        line('r1', 7, [
          [46.5, 6.6],
          [46.6, 6.7],
        ]),
        line('r2', undefined, [
          [10, 20],
          [11, 21],
        ]),
      ],
    });
    expect(out.features).toHaveLength(2);
    expect(out.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [6.6, 46.5],
        [6.7, 46.6],
      ],
    });
    expect(out.features[0].properties).toMatchObject({
      id: 'r1',
      number: 7,
      color: routePalette[routePaletteIndex('r1')],
    });
    expect(out.features[1].properties).toMatchObject({
      id: 'r2',
      color: routePalette[routePaletteIndex('r2')],
    });
  });

  it('keeps each route its colour when a regroup puts a new route ahead of it', () => {
    const cache = createRouteLineCache();
    const pts: [number, number][] = [
      [1, 2],
      [3, 4],
    ];
    const colourOf = (out: GeoJSON.FeatureCollection, id: string) =>
      out.features.find((f) => f.id === id)?.properties?.color;
    const before = cache.collection({
      generation: 1,
      routes: ['north', 'river', 'hills'].map((id) => line(id, undefined, pts)),
    });
    const after = cache.collection({
      generation: 2,
      routes: ['harbour', 'north', 'river', 'hills'].map((id) => line(id, undefined, pts)),
    });
    for (const id of ['north', 'river', 'hills']) {
      expect(colourOf(before, id)).toBeDefined();
      expect(colourOf(after, id)).toBe(colourOf(before, id));
    }
  });

  it('colours a route the same whatever line drops out ahead of it', () => {
    const pts: [number, number][] = [
      [1, 2],
      [3, 4],
    ];
    const out = createRouteLineCache().collection({
      generation: 1,
      routes: [line('stub', 1, [[1, 2]]), line('coast', 2, pts)],
    });
    expect(out.features[0]?.properties?.color).toBe(routePalette[routePaletteIndex('coast')]);
  });

  it('leaves out a route with fewer than two points', () => {
    const out = createRouteLineCache().collection({
      generation: 1,
      routes: [
        line('one', 1, [[46.5, 6.6]]),
        line('none', 2, []),
        line('ok', 3, [
          [1, 2],
          [3, 4],
        ]),
      ],
    });
    expect(out.features.map((f) => f.properties?.id)).toEqual(['ok']);
  });

  it('returns the same object for an unchanged generation and a new one when it moves', () => {
    const cache = createRouteLineCache();
    const routes = [
      line('r1', 1, [
        [1, 2],
        [3, 4],
      ]),
    ];
    const first = cache.collection({ generation: 4, routes });
    expect(cache.collection({ generation: 4, routes: [...routes] })).toBe(first);
    expect(cache.collection({ generation: 5, routes })).not.toBe(first);
  });

  it('answers the shared empty collection when there is no layer', () => {
    const cache = createRouteLineCache();
    const out = cache.collection(undefined);
    expect(out.features).toEqual([]);
    expect(cache.collection(undefined)).toBe(out);
  });
});
