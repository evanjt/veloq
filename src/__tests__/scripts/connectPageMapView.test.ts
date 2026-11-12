/**
 * Scenario: the global map on the connect page lists what the viewport holds,
 * narrows that list to a box the athlete drags, and keeps its filters in the
 * hash.
 *
 * Expected behaviour: an activity is in view when its bounds meet the
 * viewport, a route or section when a segment of its line does, even with no
 * vertex inside; a dragged box is the same test over a smaller area, whichever
 * corner it starts from; the hash carries only what differs from the default
 * and reads back to the same state, and an unknown value reads as the default.
 */

import { parse } from '../../../web/connect/router';
import {
  BANDS,
  DEFAULT_MAP,
  bandLabel,
  isMetricSetting,
  boxFromCorners,
  boundsOfFeatures,
  inView,
  mapHash,
  openRef,
  readMapQuery,
  type LineFeature,
  type MapActivity,
} from '../../../web/connect/map/view';

const activity = (id: string, box: [number, number, number, number]): MapActivity => ({
  activityId: id,
  bounds: { minLng: box[0], minLat: box[1], maxLng: box[2], maxLat: box[3] },
});

const line = (id: string, coordinates: [number, number][]): LineFeature => ({
  id,
  properties: { id },
  geometry: { type: 'LineString', coordinates },
});

const activities = [
  activity('in', [7.0, 46.0, 7.2, 46.2]),
  activity('beside', [8.0, 46.0, 8.2, 46.2]),
  activity('around', [6.0, 45.0, 9.0, 47.0]),
];
const routes = [
  line('r-through', [
    [6.5, 46.1],
    [7.5, 46.1],
  ]),
  line('r-away', [
    [10, 50],
    [11, 51],
  ]),
];
const sections = [
  line('s-inside', [
    [7.05, 46.05],
    [7.06, 46.06],
  ]),
  line('s-one-point', [[7.1, 46.1]]),
];

describe('what the viewport holds', () => {
  const viewport = [7.01, 46.01, 7.4, 46.4] as [number, number, number, number];

  it('lists activities whose bounds meet the viewport, including one that surrounds it', () => {
    const held = inView(viewport, { activities, routes, sections });
    expect(held.activities.map((a) => a.activityId)).toEqual(['in', 'around']);
  });

  it('lists a line that crosses the viewport with no vertex inside it', () => {
    const held = inView(viewport, { activities, routes, sections });
    expect(held.routes.map((r) => r.id)).toEqual(['r-through']);
    expect(held.sections.map((s) => s.id)).toEqual(['s-inside']);
  });

  it('holds nothing over an empty library', () => {
    expect(inView(viewport, { activities: [], routes: [], sections: [] })).toEqual({
      activities: [],
      routes: [],
      sections: [],
    });
  });

  it('counts a viewport that wraps the antimeridian on both sides', () => {
    const wrap = [170, -10, -170, 10] as [number, number, number, number];
    const held = inView(wrap, {
      activities: [activity('east', [175, 0, 176, 1]), activity('west', [-175, 0, -174, 1])],
      routes: [],
      sections: [],
    });
    expect(held.activities.map((a) => a.activityId)).toEqual(['east', 'west']);
  });
});

describe('a dragged box', () => {
  it('is the same box whichever corner it starts from', () => {
    expect(boxFromCorners([7.4, 46.4], [7.0, 46.0])).toEqual([7.0, 46.0, 7.4, 46.4]);
    expect(boxFromCorners([7.0, 46.4], [7.4, 46.0])).toEqual([7.0, 46.0, 7.4, 46.4]);
  });

  it('narrows the list to what it holds', () => {
    const box = boxFromCorners([7.9, 45.9], [8.3, 46.3]);
    expect(
      inView(box, { activities, routes, sections }).activities.map((a) => a.activityId)
    ).toEqual(['beside', 'around']);
  });
});

describe('the bounds of what is listed', () => {
  it('fits the lines and the activities, and nothing when there are none', () => {
    expect(
      boundsOfFeatures(
        [
          line('a', [
            [1, 2],
            [3, 4],
          ]),
          line('b', [
            [-1, 0],
            [0, 9],
          ]),
        ],
        []
      )
    ).toEqual([-1, 0, 3, 9]);
    expect(boundsOfFeatures([], [activity('x', [7, 46, 8, 47])])).toEqual([7, 46, 8, 47]);
    expect(boundsOfFeatures([], [])).toBeNull();
  });
});

describe('the map in the hash', () => {
  it('writes nothing for the defaults', () => {
    expect(mapHash(DEFAULT_MAP)).toBe('#/map');
  });

  it('round-trips layers, band, range, sports, search and the open detail', () => {
    const state = {
      range: 'thisYear' as const,
      sports: ['Ride', 'Trail Run'],
      band: 'medium' as const,
      layers: ['heatmap', 'sections'] as const,
      needle: 'lake loop',
      open: 'section:s_9',
    };
    const hash = mapHash({ ...state, layers: [...state.layers] });
    expect(readMapQuery(parse(hash))).toEqual({ ...state, layers: [...state.layers] });
  });

  it('keeps a map with every layer off distinct from the default', () => {
    const none = { ...DEFAULT_MAP, layers: [] };
    expect(readMapQuery(parse(mapHash(none))).layers).toEqual([]);
  });

  it('reads an unknown range, band or layer as the default', () => {
    const route = parse('#/map?range=forever&band=huge&layers=heatmap,lava&open=bogus');
    const state = readMapQuery(route);
    expect(state.range).toBeNull();
    expect(state.band).toBe('all');
    expect(state.layers).toEqual(['heatmap']);
    expect(state.open).toBeNull();
  });
});

describe('the open detail', () => {
  it('names a route or a section and nothing else', () => {
    expect(openRef('section:s_9')).toEqual({ kind: 'section', id: 's_9' });
    expect(openRef('route:r-1')).toEqual({ kind: 'route', id: 'r-1' });
    expect(openRef('activity:a1')).toBeNull();
    expect(openRef('section:')).toBeNull();
    expect(openRef(null)).toBeNull();
  });
});

describe('the distance bands', () => {
  it("are named by the engine's cuts in the athlete's unit", () => {
    expect(BANDS.map((band) => bandLabel(band, true))).toEqual([
      '',
      '<5 km',
      '5–10 km',
      '10–50 km',
      '50+ km',
    ]);
    expect(bandLabel('xShort', false)).toBe('<3 mi');
    expect(bandLabel('long', false)).toBe('30+ mi');
  });

  it('read the resolved unit system, metric when it says nothing', () => {
    expect(isMetricSetting('imperial')).toBe(false);
    expect(isMetricSetting('"imperial"')).toBe(false);
    expect(isMetricSetting('metric')).toBe(true);
    expect(isMetricSetting(null)).toBe(true);
  });
});
