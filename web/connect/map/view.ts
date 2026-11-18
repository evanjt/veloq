// What the global map shows and keeps: the filters in the hash, the list of what
// the viewport holds, and the box the athlete drags. Pure, so a test drives it
// without a renderer.

import { SPORT_FAMILY_MEMBERS, type SportFamily } from '@/shared/native/sportTaxonomy.generated';

import { queryValue, type Route, write } from '../router';
import { RANGES, type RangePreset } from '../table';
import { orderKey } from '../tableOrder';
import type { PageBase } from './style';

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

/** How the activity markers are coloured: by sport family, or by how long ago the activity was. */
export const COLOURINGS = ['sport', 'recency'] as const;
export type Colouring = (typeof COLOURINGS)[number];

/** What the list pane holds. */
export const LISTS = ['activities', 'routes', 'sections'] as const;

export type ListKind = (typeof LISTS)[number];

/** The bases the address may name; a colour scheme's own is the absence of one. */
export const BASES = ['light', 'dark', 'satellite'] as const satisfies readonly PageBase[];

/** Where the camera is: the centre as `[lng, lat]` and the zoom. */
export type Viewport = { center: [number, number]; zoom: number };

export type MapState = {
  range: RangePreset | null;
  /** The sport types kept; none keeps every sport. */
  sports: string[];
  band: Band;
  layers: Layer[];
  needle: string;
  /**
   * What the selection panel holds: `activity:<id>`, `route:<id>`, `section:<id>`, or
   * `point:<lng>,<lat>` for a click on the heatmap.
   */
  selected: string | null;
  /** The activity list's order as the address writes it, `column:asc|desc`; null for the default. */
  sort: string | null;
  list: ListKind;
  /** The camera the address restores; null leaves the map where its first fit puts it. */
  view: Viewport | null;
  colour: Colouring;
  /** The base chosen; null follows the page's colour scheme. */
  base: PageBase | null;
  /** The first day the timeline shows, `YYYY-MM-DD`; null starts at the first activity. */
  since: string | null;
  /** The map draped over the elevation model and tilted. */
  terrain: boolean;
  /** The last day the timeline shows, `YYYY-MM-DD`; null shows every day. */
  until: string | null;
  /** Whether the floating panel is open; false folds it to its chip. */
  panel: boolean;
};

/** The table id the activity list's order is kept under. */
export const ACTIVITY_LIST = 'map-activities';

export const DEFAULT_MAP: Readonly<MapState> = Object.freeze({
  range: null,
  sports: [],
  band: 'all',
  layers: [...LAYERS],
  needle: '',
  selected: null,
  sort: null,
  list: 'activities',
  view: null,
  colour: 'sport',
  base: null,
  since: null,
  terrain: false,
  until: null,
  panel: true,
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
  if (selectionRef(state.selected)) query.push(['selected', state.selected as string]);
  if (state.sort) query.push([orderKey(ACTIVITY_LIST), state.sort]);
  if (state.list !== 'activities') query.push(['list', state.list]);
  if (state.view) {
    const [lng, lat] = state.view.center;
    query.push(['view', [lng.toFixed(5), lat.toFixed(5), state.view.zoom.toFixed(2)].join(',')]);
  }
  if (state.colour !== 'sport') query.push(['colour', state.colour]);
  if (state.base) query.push(['base', state.base]);
  if (state.since) query.push(['since', state.since]);
  if (state.terrain) query.push(['terrain', '1']);
  if (state.until) query.push(['until', state.until]);
  if (!state.panel) query.push(['panel', 'closed']);
  return query;
}

/** The map's hash for a state. */
export function mapHash(state: MapState): string {
  return write({ screen: 'map', id: null, query: mapQuery(state) });
}

/** The state in a route's query; anything unknown reads as the default. */
export function readMapQuery(route: Route): MapState {
  const get = (key: string) => queryValue(route, key);
  const layers = get('layers');
  const selected = get('selected');
  return {
    range: RANGES.find((preset) => preset === get('range')) ?? null,
    sports: (get('sport') ?? '').split(',').filter(Boolean),
    band: BANDS.find((band) => band === get('band')) ?? 'all',
    layers:
      layers === null ? [...LAYERS] : LAYERS.filter((layer) => layers.split(',').includes(layer)),
    needle: get('q') ?? '',
    selected: selectionRef(selected) ? selected : null,
    sort: get(orderKey(ACTIVITY_LIST)),
    list: LISTS.find((list) => list === get('list')) ?? 'activities',
    view: readViewport(get('view')),
    colour: COLOURINGS.find((colouring) => colouring === get('colour')) ?? 'sport',
    base: BASES.find((base) => base === get('base')) ?? null,
    terrain: get('terrain') === '1',
    since: dayOrNull(get('since')),
    until: dayOrNull(get('until')),
    panel: get('panel') !== 'closed',
  };
}

function dayOrNull(text: string | null): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(text ?? '') ? text : null;
}

function readViewport(text: string | null): Viewport | null {
  const [lng, lat, zoom, ...rest] = (text ?? '').split(',').map(Number);
  if (rest.length || lng === undefined || lat === undefined || zoom === undefined) return null;
  if (![lng, lat, zoom].every(Number.isFinite)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90 || zoom < 0 || zoom > 24) return null;
  return { center: [lng, lat], zoom };
}

export type Selection =
  { kind: 'activity' | 'route' | 'section'; id: string } | { kind: 'point'; at: [number, number] };

/** What a `selected` value names, or null for any other text. */
export function selectionRef(selected: string | null): Selection | null {
  const found = /^(activity|route|section|point):(.+)$/.exec(selected ?? '');
  if (!found) return null;
  const kind = found[1] as Selection['kind'];
  const rest = found[2] as string;
  if (kind !== 'point') return { kind, id: rest };
  const [lng, lat, ...extra] = rest.split(',').map(Number);
  if (extra.length || lng === undefined || lat === undefined) return null;
  return Number.isFinite(lng) && Number.isFinite(lat) ? { kind, at: [lng, lat] } : null;
}

/**
 * The box a selection names, as far as what is loaded can say: null for a point, for no
 * selection, and until the selected item is among what has loaded.
 */
export function selectionBounds(
  selected: string | null,
  activities: readonly MapActivity[],
  routes: readonly LineFeature[],
  sections: readonly LineFeature[]
): Box | null {
  const selection = selectionRef(selected);
  if (!selection || selection.kind === 'point') return null;
  if (selection.kind === 'activity')
    return boundsOfFeatures(
      [],
      activities.filter((a) => a.activityId === selection.id)
    );
  const lines = (selection.kind === 'route' ? routes : sections).filter(
    (line) => line.id === selection.id
  );
  return boundsOfFeatures(lines, []);
}

/** The selection value for a click on the heatmap. */
export function pointSelection(at: [number, number]): string {
  return `point:${at[0].toFixed(5)},${at[1].toFixed(5)}`;
}

export type { SportFamily };

/** The family name the engine's lower-case family spells, as the taxonomy keys it. */
export const familyName = (engine: string): SportFamily =>
  (engine.charAt(0).toUpperCase() + engine.slice(1)) as SportFamily;

const familyOf = (type: string): SportFamily =>
  (Object.keys(SPORT_FAMILY_MEMBERS) as SportFamily[]).find((family) =>
    (SPORT_FAMILY_MEMBERS[family] as readonly string[]).includes(type)
  ) ?? 'Other';

/** The family a sport type is drawn in; a type no family lists is Other. */
export const sportFamilyOf = familyOf;

const typesOf = (family: SportFamily, available: readonly string[]) =>
  available.filter((type) => familyOf(type) === family);

/** A family chip is on when every sport type the library holds in it is chosen. */
export function familyChipOn(
  sports: readonly string[],
  family: SportFamily,
  available: readonly string[]
): boolean {
  const types = typesOf(family, available);
  return types.length > 0 && types.every((type) => sports.includes(type));
}

/** The sport types after a family chip is pressed: its types all on, or all off when they were. */
export function toggleFamily(
  sports: readonly string[],
  family: SportFamily,
  available: readonly string[]
): string[] {
  const types = typesOf(family, available);
  if (familyChipOn(sports, family, available)) return sports.filter((s) => !types.includes(s));
  return [...sports, ...types.filter((type) => !sports.includes(type))];
}

const isoDay = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** The activities from the first day to the last, both inclusive; null leaves that end open. */
export function within<A extends { date: number }>(
  rows: readonly A[],
  since: string | null,
  until: string | null
): A[] {
  return rows.filter((row) => {
    const day = isoDay(row.date);
    return (since === null || day >= since) && (until === null || day <= until);
  });
}

export type MonthMark = {
  /** `YYYY-MM`. */
  month: string;
  /** Where the month starts along the timeline, 0 at the first day and under 1. */
  position: number;
  /** Whether an activity falls in the month. */
  active: boolean;
};

const DAY_SECONDS = 86_400;

/** A mark for each month the timeline spans, solid where an activity falls and muted where none does. */
export function monthMarks(first: number, last: number, dates: readonly number[]): MonthMark[] {
  if (dates.length === 0) return [];
  const from = new Date(first * 1000);
  const days = Math.max(1, Math.round((last - first) / DAY_SECONDS));
  const used = new Set(dates.map((date) => isoDay(date).slice(0, 7)));
  const marks: MonthMark[] = [];
  const end = isoDay(last).slice(0, 7);
  for (let at = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1); ;) {
    const month = new Date(at).toISOString().slice(0, 7);
    if (month > end) break;
    const starts = Math.max(first, at / 1000);
    marks.push({
      month,
      position: Math.min(0.999, (starts - first) / DAY_SECONDS / days),
      active: used.has(month),
    });
    const next = new Date(at);
    at = Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
  }
  return marks;
}

const AGE_SPAN_SECONDS = 365 * 86_400;

/** How old an activity is on a scale from 0 (now) to 1 (a year or more), as the age colour reads it. */
export function recencyAge(date: number, now: number): number {
  return Math.min(1, Math.max(0, (now - date) / AGE_SPAN_SECONDS));
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
