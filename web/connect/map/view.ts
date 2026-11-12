// What the global map shows and keeps: the filters in the hash, the list of what
// the viewport holds, and the box the athlete drags. Pure, so a test drives it
// without a renderer.

import { type Route, write } from '../router';
import { RANGES, type RangePreset } from '../table';

/** `[west, south, east, north]`. West may exceed east for a view across the antimeridian. */
export type Box = [number, number, number, number];

/** An activity as the map read lists it, as far as the list needs. */
export type MapActivity = {
  activityId: string;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

/** A route or section line as the GeoJSON layer writes it. */
export type LineFeature = {
  id: string;
  properties: Record<string, unknown>;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
};

export const LAYERS = ['heatmap', 'routes', 'sections', 'starts'] as const;
export type Layer = (typeof LAYERS)[number];

/** The distance bands, as the engine's `MapDistanceBand` spells them. */
export const BANDS = ['all', 'xShort', 'short', 'medium', 'long'] as const;
export type Band = (typeof BANDS)[number];

export type MapState = {
  range: RangePreset | null;
  /** The sport types kept; none keeps every sport. */
  sports: string[];
  band: Band;
  layers: Layer[];
  needle: string;
  /** `section:<id>` or `route:<id>`: the detail open in the side pane. */
  open: string | null;
};

export const DEFAULT_MAP: Readonly<MapState> = Object.freeze({
  range: null,
  sports: [],
  band: 'all',
  layers: [...LAYERS],
  needle: '',
  open: null,
});

const sameLayers = (a: readonly Layer[], b: readonly Layer[]) =>
  a.length === b.length && a.every((layer, at) => layer === b[at]);

/** The state as hash query pairs; a default is not written. */
export function mapQuery(state: MapState): [string, string][] {
  const query: [string, string][] = [];
  if (state.range) query.push(['range', state.range]);
  if (state.sports.length) query.push(['sport', state.sports.join(',')]);
  if (state.band !== 'all') query.push(['band', state.band]);
  const layers = LAYERS.filter((layer) => state.layers.includes(layer));
  if (!sameLayers(layers, LAYERS))
    query.push(['layers', layers.length ? layers.join(',') : 'none']);
  if (state.needle) query.push(['q', state.needle]);
  if (openRef(state.open)) query.push(['open', state.open as string]);
  return query;
}

/** The map's hash for a state. */
export function mapHash(state: MapState): string {
  return write({ screen: 'map', id: null, query: mapQuery(state) });
}

/** The state in a route's query; anything unknown reads as the default. */
export function readMapQuery(route: Route): MapState {
  const get = (key: string) => route.query.find(([name]) => name === key)?.[1] ?? null;
  const layers = get('layers');
  const open = get('open');
  return {
    range: RANGES.find((preset) => preset === get('range')) ?? null,
    sports: (get('sport') ?? '').split(',').filter(Boolean),
    band: BANDS.find((band) => band === get('band')) ?? 'all',
    layers:
      layers === null ? [...LAYERS] : LAYERS.filter((layer) => layers.split(',').includes(layer)),
    needle: get('q') ?? '',
    open: openRef(open) ? open : null,
  };
}

/** The route or section an `open` value names, or null for any other text. */
export function openRef(open: string | null): { kind: 'route' | 'section'; id: string } | null {
  const found = /^(route|section):(.+)$/.exec(open ?? '');
  return found ? { kind: found[1] as 'route' | 'section', id: found[2] as string } : null;
}

/** The box two opposite corners, `[lng, lat]`, span. */
export function boxFromCorners(a: [number, number], b: [number, number]): Box {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** The longitude spans a box covers: one, or two when it crosses the antimeridian. */
function spans(box: Box): [number, number][] {
  return box[0] <= box[2]
    ? [[box[0], box[2]]]
    : [
        [box[0], 180],
        [-180, box[2]],
      ];
}

function boxesMeet(a: Box, b: Box): boolean {
  if (a[1] > b[3] || b[1] > a[3]) return false;
  return spans(a).some(([aw, ae]) => spans(b).some(([bw, be]) => aw <= be && bw <= ae));
}

/** Where a segment from `p` to `q` meets a rectangle: Liang-Barsky clipping. */
function segmentMeets(
  p: [number, number],
  q: [number, number],
  box: [number, number, number, number]
): boolean {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let near = 0;
  let far = 1;
  const edges: [number, number][] = [
    [-dx, p[0] - box[0]],
    [dx, box[2] - p[0]],
    [-dy, p[1] - box[1]],
    [dy, box[3] - p[1]],
  ];
  for (const [step, room] of edges) {
    if (step === 0) {
      if (room < 0) return false;
    } else {
      const at = room / step;
      if (step < 0) near = Math.max(near, at);
      else far = Math.min(far, at);
      if (near > far) return false;
    }
  }
  return true;
}

function lineMeets(line: LineFeature, box: Box): boolean {
  const points = line.geometry.coordinates;
  const flat = spans(box).map(([west, east]): [number, number, number, number] => [
    west,
    box[1],
    east,
    box[3],
  ]);
  return points.some((point, at) => {
    const next = points[at + 1];
    return next !== undefined && flat.some((part) => segmentMeets(point, next, part));
  });
}

export type MapContents<A extends MapActivity = MapActivity> = {
  activities: A[];
  routes: LineFeature[];
  sections: LineFeature[];
};

/** What a viewport, or a box dragged inside it, holds. A line under two points holds nothing. */
export function inView<A extends MapActivity>(box: Box, all: MapContents<A>): MapContents<A> {
  return {
    activities: all.activities.filter((activity) =>
      boxesMeet(box, [
        activity.bounds.minLng,
        activity.bounds.minLat,
        activity.bounds.maxLng,
        activity.bounds.maxLat,
      ])
    ),
    routes: all.routes.filter((line) => lineMeets(line, box)),
    sections: all.sections.filter((line) => lineMeets(line, box)),
  };
}

/** The bounds of the lines and activities listed, or null when there are none. */
export function boundsOfFeatures(
  lines: readonly LineFeature[],
  activities: readonly MapActivity[]
): Box | null {
  let box: Box | null = null;
  const grow = (west: number, south: number, east: number, north: number) => {
    box = box
      ? [
          Math.min(box[0], west),
          Math.min(box[1], south),
          Math.max(box[2], east),
          Math.max(box[3], north),
        ]
      : [west, south, east, north];
  };
  for (const line of lines)
    for (const [lng, lat] of line.geometry.coordinates) grow(lng, lat, lng, lat);
  for (const { bounds } of activities)
    grow(bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat);
  return box;
}

/** The band as a distance range in the athlete's unit; the engine cuts at these figures. */
export function bandLabel(band: Band, metric: boolean): string {
  const unit = metric ? 'km' : 'mi';
  const [x, s, m] = metric ? [5, 10, 50] : [3, 6, 30];
  switch (band) {
    case 'all':
      return '';
    case 'xShort':
      return `<${x} ${unit}`;
    case 'short':
      return `${x}–${s} ${unit}`;
    case 'medium':
      return `${s}–${m} ${unit}`;
    default:
      return `${m}+ ${unit}`;
  }
}

/** Whether the unit system the phone resolved is metric; text it cannot read is metric. */
export function isMetricSetting(value: string | null | undefined): boolean {
  return !/imperial/i.test(value ?? '');
}
