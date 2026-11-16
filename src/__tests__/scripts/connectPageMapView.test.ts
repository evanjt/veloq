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
  activitiesUnder,
  familyChipOn,
  mapHash,
  readMapQuery,
  recencyAge,
  selectionRef,
  toggleFamily,
  monthMarks,
  within,
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

  vaultIt('holds nothing over an empty library', () => {
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
  vaultIt('fits the lines and the activities, and nothing when there are none', () => {
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
  vaultIt('writes nothing for the defaults', () => {
    expect(mapHash(DEFAULT_MAP)).toBe('#/map');
  });

  it('round-trips layers, band, range, sports, search, selection, viewport, colour, base, terrain and timeline', () => {
    const state = {
      range: 'thisYear' as const,
      sports: ['Ride', 'Trail Run'],
      band: 'medium' as const,
      layers: ['heatmap', 'sections'] as const,
      needle: 'lake loop',
      selected: 'section:s_9',
      sort: 'distance:asc',
      view: { center: [7.4521, 46.0123] as [number, number], zoom: 11.25 },
      colour: 'recency' as const,
      base: 'satellite' as const,
      terrain: true,
      since: '2026-01-15',
      until: '2026-03-01',
      panel: false,
      list: 'routes' as const,
    };
    const hash = mapHash({ ...state, layers: [...state.layers] });
    expect(readMapQuery(parse(hash))).toEqual({ ...state, layers: [...state.layers] });
  });

  vaultIt('keeps a map with every layer off distinct from the default', () => {
    const none = { ...DEFAULT_MAP, layers: [] };
    expect(readMapQuery(parse(mapHash(none))).layers).toEqual([]);
  });

  vaultIt('reads an unknown range, band or layer as the default', () => {
    const route = parse(
      '#/map?range=forever&band=huge&list=bogus&layers=heatmap,lava&selected=bogus&view=x,y,z&colour=neon&base=sepia&terrain=deep&until=soon'
    );
    const state = readMapQuery(route);
    expect(state.range).toBeNull();
    expect(state.band).toBe('all');
    expect(state.layers).toEqual(['heatmap']);
    expect(state.selected).toBeNull();
    expect(state.view).toBeNull();
    expect(state.colour).toBe('sport');
    expect(state.base).toBeNull();
    expect(state.terrain).toBe(false);
    expect(state.until).toBeNull();
    expect(state.list).toBe('activities');
  });

  it('keeps a selection that names an activity, and a point on the heatmap', () => {
    const activity = readMapQuery(parse('#/map?selected=activity:a1'));
    expect(activity.selected).toBe('activity:a1');
    const point = readMapQuery(parse('#/map?selected=point:7.5,46.25'));
    expect(point.selected).toBe('point:7.5,46.25');
  });

  it('keeps a viewport in the hash to a precision that is a few metres', () => {
    const hash = mapHash({
      ...DEFAULT_MAP,
      view: { center: [7.123456789, 46.987654321], zoom: 12.3456 },
    });
    expect(hash).toBe('#/map?view=7.12346%2C46.98765%2C12.35');
  });
});

describe('the selection', () => {
  it('names an activity, a route, a section or a point and nothing else', () => {
    expect(selectionRef('section:s_9')).toEqual({ kind: 'section', id: 's_9' });
    expect(selectionRef('route:r-1')).toEqual({ kind: 'route', id: 'r-1' });
    expect(selectionRef('activity:a1')).toEqual({ kind: 'activity', id: 'a1' });
    expect(selectionRef('point:7.5,-46.25')).toEqual({ kind: 'point', at: [7.5, -46.25] });
    expect(selectionRef('point:7.5')).toBeNull();
    expect(selectionRef('point:a,b')).toBeNull();
    expect(selectionRef('section:')).toBeNull();
    expect(selectionRef('bogus:1')).toBeNull();
    expect(selectionRef(null)).toBeNull();
  });
});

describe('the sport family chips', () => {
  const available = ['Ride', 'VirtualRide', 'Run', 'Quidditch'];

  it('turns on every available type of a family and off again', () => {
    const on = toggleFamily([], 'Ride', available);
    expect(on).toEqual(['Ride', 'VirtualRide']);
    expect(familyChipOn(on, 'Ride', available)).toBe(true);
    expect(familyChipOn(on, 'Run', available)).toBe(false);
    expect(toggleFamily(on, 'Ride', available)).toEqual([]);
  });

  it('completes a half-chosen family rather than clearing it, and leaves other families alone', () => {
    expect(toggleFamily(['Ride', 'Run'], 'Ride', available)).toEqual([
      'Ride',
      'Run',
      'VirtualRide',
    ]);
    expect(familyChipOn(['Ride'], 'Ride', available)).toBe(false);
    expect(toggleFamily(['Ride', 'VirtualRide', 'Run'], 'Ride', available)).toEqual(['Run']);
  });

  it('files a type no family lists under other, and a family with no available type is never on', () => {
    expect(toggleFamily([], 'Other', available)).toEqual(['Quidditch']);
    expect(familyChipOn([], 'Winter', available)).toBe(false);
    expect(toggleFamily([], 'Winter', available)).toEqual([]);
  });
});

describe('the timeline', () => {
  const day = (iso: string) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);
  const rows = [
    { activityId: 'a', date: day('2026-01-10') },
    { activityId: 'b', date: day('2026-03-01') },
    { activityId: 'c', date: day('2026-03-02') },
  ];

  it('keeps activities up to and including the day the right handle stands on', () => {
    expect(within(rows, null, '2026-03-01').map((r) => r.activityId)).toEqual(['a', 'b']);
  });

  it('keeps every activity with no handle placed, and none before the first', () => {
    expect(within(rows, null, null)).toHaveLength(3);
    expect(within(rows, null, '2025-12-31')).toEqual([]);
  });

  it('keeps activities from the day the left handle stands on, both ends inclusive', () => {
    expect(within(rows, '2026-03-01', null).map((r) => r.activityId)).toEqual(['b', 'c']);
    expect(within(rows, '2026-01-10', '2026-03-01').map((r) => r.activityId)).toEqual(['a', 'b']);
    expect(within(rows, '2026-03-02', '2026-03-01')).toEqual([]);
  });

  it('marks each month from the first day to the last, solid where an activity falls', () => {
    const marks = monthMarks(
      day('2026-01-10'),
      day('2026-04-20'),
      rows.map((r) => r.date)
    );
    expect(marks.map((m) => [m.month, m.active])).toEqual([
      ['2026-01', true],
      ['2026-02', false],
      ['2026-03', true],
      ['2026-04', false],
    ]);
    const positions = marks.map((m) => m.position);
    expect(positions[0]).toBe(0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.at(-1)).toBeLessThan(1);
  });

  it('marks the one month of a single day, and nothing for no days', () => {
    expect(monthMarks(day('2026-05-05'), day('2026-05-05'), [day('2026-05-05')])).toEqual([
      { month: '2026-05', position: 0, active: true },
    ]);
    expect(monthMarks(0, 0, [])).toEqual([]);
  });
});

describe('the floating panel in the hash', () => {
  it('is open by default and writes only when collapsed', () => {
    expect(DEFAULT_MAP.panel).toBe(true);
    expect(mapHash({ ...DEFAULT_MAP, panel: false })).toBe('#/map?panel=closed');
    expect(readMapQuery(parse('#/map?panel=closed')).panel).toBe(false);
    expect(readMapQuery(parse('#/map?panel=other')).panel).toBe(true);
  });

  it('reads a range of days either side and ignores a malformed one', () => {
    const state = readMapQuery(parse('#/map?since=2026-01-15&until=oops'));
    expect(state.since).toBe('2026-01-15');
    expect(state.until).toBeNull();
  });
});

describe('the age colour', () => {
  const now = Date.parse('2026-06-01T00:00:00Z') / 1000;
  const YEAR = 365 * 86_400;

  it('runs from 0 for today to 1 at a year, and stays inside', () => {
    expect(recencyAge(now, now)).toBe(0);
    expect(recencyAge(now - YEAR / 2, now)).toBeCloseTo(0.5);
    expect(recencyAge(now - 3 * YEAR, now)).toBe(1);
    expect(recencyAge(now + 100, now)).toBe(0);
  });
});

describe('what lies under a point on the heatmap', () => {
  it('lists the activities whose bounds hold the point', () => {
    const held = activitiesUnder([7.1, 46.1], activities);
    expect(held.map((a) => a.activityId)).toEqual(['in', 'around']);
    expect(activitiesUnder([20, 20], activities)).toEqual([]);
  });
});

describe('the distance bands', () => {
  vaultIt("are named by the engine's cuts in the athlete's unit", () => {
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

  vaultIt('read the resolved unit system, metric when it says nothing', () => {
    expect(isMetricSetting('imperial')).toBe(false);
    expect(isMetricSetting('"imperial"')).toBe(false);
    expect(isMetricSetting('metric')).toBe(true);
    expect(isMetricSetting(null)).toBe(true);
  });
});
