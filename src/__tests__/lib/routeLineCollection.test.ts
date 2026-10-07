/**
 * Scenario: the map read hands the route-line layer over as encoded polylines.
 *
 * Expected behaviour: each line becomes one LineString in `[lng, lat]` order, a route
 * with fewer than two points is left out because the iOS renderer crashes on one, the
 * colours follow the route palette in order, and the same layer generation hands back
 * the same collection object so MapLibre is not given new data for an unchanged layer.
 */
import { routePalette } from '@/theme';
import { createRouteLineCache } from '@/features/maps/lib/routeLineCollection';

import { encodeTrack } from '../__shared__/trackBytes';

const line = (routeId: string, routeNumber: number | undefined, pts: [number, number][]) => ({
  routeId,
  routeNumber,
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
      color: routePalette[0],
    });
    expect(out.features[1].properties).toMatchObject({ id: 'r2', color: routePalette[1] });
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
