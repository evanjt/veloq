// `#/map`: the global map. The heatmap is the engine's own tiles, the route and
// section lines are GeoJSON the engine writes, and the activities, counts and
// empty reasons are the phone's map read. The map fills the page, and its
// controls float over it: one panel at the top left holds the filters and the
// activity list, and opens a selection in place; the layer controls sit at the
// top right, the legend at the bottom left and the timeline along the bottom.
// The filters, the selection, the panel, the range and the viewport live in the
// hash, and a row and its mark on the map light each other.

import { localWallClockToEpochSeconds } from '@/shared/time/startDate';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';

import type { MapSurfaceSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';
import { EMPTY_FEATURE_COLLECTION } from '@/features/maps/lib/coordinates';
import { routePalette, routePaletteExpression, sectionPalette } from '@/theme/colors';
import { colourIndexExpression } from '@/theme/palette';

import { ReadError, type QueryClient } from '../query';
import type { Methods } from '../schema';
import { ReadNotice } from '../shell/StatePanes';
import { useRead as useQueryRead } from '../useRead';
import {
  formatOrder,
  go as navigate,
  parse,
  parseOrder,
  type Ordering,
  type Route,
  write,
} from '../router';
import { isDarkScheme } from '../appearance';
import { clock, km } from '../format';
import { useSportName } from '../names';
import { sportMark } from '../preview';
import { SportGlyph } from '../SportGlyph';
import { useTableLabels } from '../tableLabels';
import { nextOrder, orderRows, sortProp } from '../tableOrder';
import { RANGE_LABELS, RANGES, rangeBounds, type RangePreset } from '../table';
import { sportFamilyColours } from '../theme';
import {
  Badge,
  Button,
  Chip,
  ChipGroup,
  DataTable,
  SearchField,
  SegmentedControl,
  TextField,
  type Column,
} from '../ui';
import { MapPane } from './MapPane';
import type { PickedFeature } from './hit';
import {
  activityRows,
  groupRows,
  kindOptions,
  underPointAsk,
  type UnderPointActivity,
  type UnderPointAnswer,
  type UnderPointGroup,
  type UnderPointKind,
} from './underPoint';
import { baseForScheme, pagePalette, toneOf, type PageBase } from './style';
import {
  ACTIVITY_LIST,
  BANDS,
  BASES,
  COLOURINGS,
  LAYERS,
  LISTS,
  bandLabel,
  boundsOfFeatures,
  selectionBounds,
  familyChipOn,
  familyName,
  inView,
  isMetricSetting,
  mapQuery,
  monthMarks,
  pointSelection,
  readMapQuery,
  recencyAge,
  selectionRef,
  sportFamilyOf,
  toggleFamily,
  within,
  type Box,
  type Colouring,
  type Layer,
  type LineFeature,
  type ListKind,
  type MapActivity,
  type MapState,
  type Viewport,
} from './view';

type Screen = Methods['map.screen']['result'];
type Activity = Screen['screen']['activities'][number];

const WORLD_ZOOM = 2;

/** What a fit keeps clear of: the panels and floating boxes drawn over the map. */
const overlays = () =>
  Array.from(document.querySelectorAll('#map-screen .map-panel, #map-screen .map-float'));
/** The heatmap is drawn from zoom 1; the map does not go out past it. */
const MIN_ZOOM = 1;
const HEATMAP_TILE_PX = 512;
const HEATMAP_MAX_ZOOM = 17;
/** How often the pass's progress is read while the map is open. */
const PROGRESS_POLL_MS = 5000;
/** How long typing pauses before the search is asked of the phone. */
const SEARCH_PAUSE_MS = 250;
const DAY_SECONDS = 86_400;
/** What the marks that are not under the pointer are drawn at while one is. */
const DIMMED_OPACITY = 0.25;

/** What the spec is built from besides the base. */
export type SpecInput = {
  methods: readonly string[];
  layers: readonly Layer[];
  heatmapVersion: number;
  routesVersion: number | null;
  sectionsVersion: number | null;
  starts: unknown;
  colouring?: Colouring;
  /** Whether a mark is under the pointer, so the others are drawn faint. */
  dim?: boolean;
  /** The activity whose track is drawn, or null for none. */
  track?: string | null;
};

/** The spec for a base and what the phone lists. A layer that is off stays mounted, hidden. */
export function mapSpec(base: PageBase, input: SpecInput): MapSurfaceSpec {
  const palette = pagePalette(base);
  const sources: MapSurfaceSpec['sources'] = {};
  const layers: MapSurfaceSpec['layers'] = [];
  const interactiveLayers: string[] = [];
  const on = (layer: Layer) => input.layers.includes(layer);
  const lit = ['case', ['boolean', ['feature-state', 'highlighted'], false]];
  const faint = input.dim ? DIMMED_OPACITY : 1;
  if (input.methods.includes('heatmap.tile')) {
    sources.heatmap = {
      kind: 'raster',
      tiles: [`veloq://heatmap-${base}/{z}/{x}/{y}?v=${input.heatmapVersion}`],
      tileSize: HEATMAP_TILE_PX,
      minzoom: MIN_ZOOM,
      maxzoom: HEATMAP_MAX_ZOOM,
    };
    layers.push({
      id: 'heatmap',
      type: 'raster',
      source: 'heatmap',
      layout: {},
      visible: on('heatmap'),
    });
  }
  if (input.methods.includes('geo.sections')) {
    sources.sections = {
      kind: 'geojson',
      data: `veloq://geo/sections/all?v=${input.sectionsVersion ?? 0}`,
    };
    layers.push({
      id: 'sections',
      type: 'line',
      source: 'sections',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': colourIndexExpression(sectionPalette, ['get', 'colorIndex']),
        'line-width': [...lit, 6, 4],
        'line-opacity': [...lit, 1, faint],
      },
      visible: on('sections'),
    });
    interactiveLayers.push('sections');
  }
  if (input.methods.includes('geo.routeLines')) {
    sources.routes = {
      kind: 'geojson',
      data: `veloq://geo/route-lines/all?v=${input.routesVersion ?? 0}`,
    };
    layers.push({
      id: 'routes',
      type: 'line',
      source: 'routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': routePaletteExpression(),
        'line-width': [...lit, 5, 3],
        'line-opacity': [...lit, 1, faint],
      },
      visible: on('routes'),
    });
    interactiveLayers.push('routes');
  }
  if (input.methods.includes('geo.track')) {
    // Mounted whether or not an activity is focused: an empty collection draws nothing.
    sources.track = {
      kind: 'geojson',
      data: input.track
        ? `veloq://geo/track/${encodeURIComponent(input.track)}`
        : EMPTY_FEATURE_COLLECTION,
    };
    layers.push({
      id: 'track',
      type: 'line',
      source: 'track',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.route, 'line-width': 4 },
      visible: on('starts'),
    });
  }
  sources.starts = { kind: 'geojson', data: input.starts as never };
  layers.push({
    id: 'starts',
    type: 'circle',
    source: 'starts',
    paint: {
      'circle-radius': [...lit, 7, 4],
      'circle-color':
        input.colouring === 'recency'
          ? [
              'interpolate',
              ['linear'],
              ['get', 'age'],
              0,
              palette.heat[4],
              0.25,
              palette.heat[3],
              0.5,
              palette.heat[2],
              0.75,
              palette.heat[1],
              1,
              palette.heat[0],
            ]
          : ['get', 'colour'],
      'circle-stroke-color': palette.casing,
      'circle-stroke-width': 1,
      'circle-opacity': [...lit, 1, faint],
      'circle-stroke-opacity': [...lit, 1, faint],
    },
    visible: on('starts'),
  });
  interactiveLayers.unshift('starts');
  return { sources, layers, interactiveLayers };
}

/** The colour a sport type's marker takes: its family's, on the base's ground. */
export function sportColour(sportType: string, base: PageBase): string {
  return sportFamilyColours[toneOf(base)][sportFamilyOf(sportType)][0];
}

/**
 * The start of each activity that has one, as the points layer draws them. Each
 * carries the colour of its sport and its age, so the layer can paint by either.
 */
export function startPoints(
  activities: readonly Activity[],
  base: PageBase = 'light',
  now: number = Math.floor(Date.now() / 1000)
) {
  return {
    type: 'FeatureCollection',
    features: activities
      .filter((a) => a.startLat !== null && a.startLng !== null)
      .map((a) => ({
        type: 'Feature',
        id: a.activityId,
        properties: {
          id: a.activityId,
          colour: sportColour(a.sportType, base),
          age: recencyAge(a.date, now),
        },
        geometry: { type: 'Point', coordinates: [a.startLng, a.startLat] },
      })),
  };
}

/** The window the state asks of the phone, in epoch seconds. */
export function windowFor(state: MapState, now: Date): { startDate: number; endDate: number } {
  const { oldestTs, newestTs } = rangeBounds(state.range, now);
  return {
    startDate: oldestTs ?? 0,
    endDate: newestTs ?? localWallClockToEpochSeconds(now) + DAY_SECONDS,
  };
}

function parseLines(text: string): LineFeature[] {
  try {
    const parsed = JSON.parse(text) as { features?: LineFeature[] };
    return parsed.features ?? [];
  } catch {
    return [];
  }
}

const isoDay = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** One read of the query layer, null until it answers and when the phone does not list it. */
function useMapRead<T>(method: keyof Methods, params: object, listed: boolean): T | null {
  const read = useQueryRead(method, listed ? (params as never) : null);
  return (read.data as T | undefined) ?? null;
}

type Row = { id: string; text: string };

const ACTIVITY_COLUMNS = ['date', 'name', 'sport', 'distance'] as const;
type ActivityColumn = (typeof ACTIVITY_COLUMNS)[number];
const ACTIVITY_ORDER: Ordering<ActivityColumn> = { column: 'date', descending: true };

export function MapScreen({
  queries,
  methods,
  route,
}: {
  queries: QueryClient;
  methods: readonly string[];
  route: Route;
}) {
  const { t } = useTranslation();
  const sportName = useSportName();
  const state = useMemo(() => readMapQuery(route), [route]);
  const base: PageBase = state.base ?? baseForScheme(isDarkScheme());
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<Box | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [needle, setNeedle] = useState(state.needle);
  const [heatmapVersion, setHeatmapVersion] = useState(0);
  // The box the camera is asked to frame; each request carries a number of its own, so asking for
  // the same box again frames it again and nothing else does.
  const [frame, setFrame] = useState<{ bounds: Box; seq: number } | null>(null);
  const frames = useRef(0);
  const setFit = useCallback((bounds: Box | null) => {
    frames.current += 1;
    setFrame(bounds ? { bounds, seq: frames.current } : null);
  }, []);
  // The selection the camera has been put on, so that a data refresh never moves it again.
  const framedFor = useRef<string | null>(null);
  // The camera the address held when the page opened; the map moves it from there.
  const [opening] = useState<Viewport | null>(state.view);
  const cameraNow = useRef<Viewport | null>(state.view);
  const hoverFromMap = useRef(false);

  const listsSettings = methods.includes('settings.get');
  const listsMapScreen = methods.includes('map.screen');
  const listsRouteLines = methods.includes('geo.routeLines');
  const listsSections = methods.includes('geo.sections');
  const listsProgress = methods.includes('heatmap.progress');
  const listsTrack = methods.includes('geo.track');
  const listsUnderPoint = methods.includes('heatmap.underPoint');
  const units = useMapRead<Methods['settings.get']['result']>(
    'settings.get',
    { keys: ['veloq-resolved-unit-system'] },
    listsSettings
  );
  const metric = isMetricSetting(units?.values.find((v) => v.value !== null)?.value);

  /** The address for a state, carrying the camera as it is now. */
  const commit = useCallback((next: MapState) => {
    navigate({
      screen: 'map',
      id: null,
      query: mapQuery({ ...next, view: cameraNow.current ?? next.view }),
    });
  }, []);
  const change = (next: Partial<MapState>) => commit({ ...state, ...next });

  const ask = useMemo(
    () => ({
      ...windowFor(state, new Date()),
      sportTypes: state.sports,
      distanceBand: state.band,
      isMetric: metric,
      nameNeedle: state.needle,
    }),
    [state, metric]
  );
  const screen = useMapRead<Screen>('map.screen', ask, listsMapScreen);
  const routeLines = useMapRead<Methods['geo.routeLines']['result']>(
    'geo.routeLines',
    { generation: screen?.routeGeneration ?? null },
    listsRouteLines
  );
  const sectionLines = useMapRead<Methods['geo.sections']['result']>(
    'geo.sections',
    { stamp: screen?.sectionStamp ?? null },
    listsSections
  );

  // The tiles are drawn while the pass runs, so the source is asked again as
  // its progress moves and once more when it stops.
  const lastProgress = useRef('');
  useEffect(() => {
    if (!listsProgress) return undefined;
    const poll = () =>
      queries
        .ask('heatmap.progress', {})
        .then((result) => {
          const { processed, total } = result as Methods['heatmap.progress']['result'];
          const key = `${processed}/${total}`;
          if (lastProgress.current !== '' && key !== lastProgress.current) {
            setHeatmapVersion((version) => version + 1);
          }
          lastProgress.current = key;
        })
        .catch(() => undefined);
    void poll();
    const timer = setInterval(poll, PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [queries, listsProgress]);

  // The search is asked of the phone once typing pauses.
  useEffect(() => {
    if (needle === state.needle) return undefined;
    const timer = setTimeout(() => commit({ ...state, needle }), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [needle, state, commit]);
  // A search the hash changes under the field (back, a link) replaces the draft.
  const [seenNeedle, setSeenNeedle] = useState(state.needle);
  if (seenNeedle !== state.needle) {
    setSeenNeedle(state.needle);
    setNeedle(state.needle);
  }

  const everyActivity = useMemo<Activity[]>(() => screen?.screen.activities ?? [], [screen]);
  const activities = useMemo(
    () => within(everyActivity, state.since, state.until),
    [everyActivity, state.since, state.until]
  );
  const routes = useMemo(() => parseLines(routeLines?.text ?? ''), [routeLines]);
  const sections = useMemo(() => parseLines(sectionLines?.text ?? ''), [sectionLines]);
  const held = useMemo(() => {
    const area = box ?? view;
    const all = { activities: activities as MapActivity[], routes, sections };
    return area ? inView(area, all) : all;
  }, [activities, routes, sections, view, box]);

  const starts = useMemo(() => startPoints(activities, base), [activities, base]);
  const selection = selectionRef(state.selected);
  const selectedId = selection && selection.kind !== 'point' ? selection.id : null;
  // What lies under a clicked point is the engine's answer at the camera's whole zoom; a phone
  // that does not offer it leaves the point selected with no list.
  const [underKind, setUnderKind] = useState<UnderPointKind>('all');
  // The zoom the camera was at when the point was clicked, so panning afterwards asks nothing new.
  const [clickZoom, setClickZoom] = useState<{ selected: string; zoom: number } | null>(null);
  const pointAsk =
    selection?.kind === 'point'
      ? underPointAsk(
          selection.at,
          clickZoom?.selected === state.selected ? clickZoom.zoom : (state.view?.zoom ?? WORLD_ZOOM)
        )
      : null;
  const underPoint = useMapRead<UnderPointAnswer>(
    'heatmap.underPoint',
    pointAsk ?? {},
    listsUnderPoint && pointAsk !== null
  );
  const focused = useMemo(() => {
    const isActivity = (id: string | null) =>
      id !== null && everyActivity.some((a) => a.activityId === id);
    if (isActivity(hovered)) return hovered;
    return selection?.kind === 'activity' ? selection.id : null;
  }, [hovered, selection, everyActivity]);
  const spec = useMemo(
    () =>
      mapSpec(base, {
        methods,
        layers: state.layers,
        heatmapVersion,
        routesVersion: screen?.routeGeneration ?? null,
        sectionsVersion: screen?.sectionStamp ?? null,
        starts,
        colouring: state.colour,
        dim: hovered !== null,
        track: listsTrack ? focused : null,
      }),
    [
      base,
      methods,
      state.layers,
      state.colour,
      heatmapVersion,
      screen?.routeGeneration,
      screen?.sectionStamp,
      starts,
      hovered,
      listsTrack,
      focused,
    ]
  );
  const camera = useMemo(
    () =>
      frame
        ? { bounds: frame.bounds, seq: frame.seq }
        : opening
          ? { center: opening.center as unknown as maplibregl.LngLat, zoom: opening.zoom }
          : { center: [0, 0] as maplibregl.LngLat, zoom: WORLD_ZOOM },
    [frame, opening]
  );
  // A selection that arrives with the address (a reload, a link, back) is framed once what it
  // names has loaded, unless the address also carries a camera. A pick from a list frames itself.
  useEffect(() => {
    if (!state.selected) {
      framedFor.current = null;
      return;
    }
    if (framedFor.current === state.selected) return;
    if (opening) {
      framedFor.current = state.selected;
      return;
    }
    const bounds = selectionBounds(state.selected, everyActivity, routes, sections);
    if (!bounds) return;
    framedFor.current = state.selected;
    setFit(bounds);
  }, [state.selected, opening, everyActivity, routes, sections, setFit]);
  const highlighted = useMemo(
    () => [...new Set([hovered, selectedId].filter((id): id is string => id !== null))],
    [hovered, selectedId]
  );

  // A mark lit from the map brings its row into the list.
  useEffect(() => {
    if (hovered === null || !hoverFromMap.current) return;
    const tableId = state.list === 'activities' ? ACTIVITY_LIST : `map-${state.list}`;
    document.getElementById(`${tableId}-row-${hovered}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [hovered, state.list]);
  const hoverFrom = (from: 'map' | 'list') => (id: string | null) => {
    hoverFromMap.current = from === 'map';
    setHovered(id);
  };

  const layerLabel = (layer: Layer) => {
    switch (layer) {
      case 'heatmap':
        return t('maps.layerHeatmap');
      case 'routes':
        return t('maps.layerRoutes');
      case 'sections':
        return t('maps.layerSections');
      default:
        return t('maps.layerActivities');
    }
  };
  const toggle = <T,>(list: readonly T[], item: T) =>
    list.includes(item) ? list.filter((held) => held !== item) : [...list, item];
  const fitAll = () => setFit(boundsOfFeatures([], activities) ?? null);
  const clearArea = () => {
    if (box) setBox(null);
    else if (state.selected) change({ selected: null });
  };
  /** A row picked in the list: selected, and the map brought to what it names. */
  const pick = (
    selected: string,
    shown: readonly MapActivity[],
    lines: readonly LineFeature[] = []
  ) => {
    const bounds = boundsOfFeatures(lines, shown);
    if (bounds) setFit(bounds);
    framedFor.current = selected;
    change({ selected });
  };
  const pickLine = (id: string) => {
    const kind = state.list === 'routes' ? 'route' : 'section';
    const line = (kind === 'route' ? routes : sections).find((each) => each.id === id);
    pick(`${kind}:${id}`, [], line ? [line] : []);
  };
  const onBox = (next: Box) => {
    setBox(next);
    setFit(next);
  };
  const onClick = (feature: PickedFeature) => {
    if (feature.id === null) return;
    const kind =
      feature.layerId === 'starts'
        ? 'activity'
        : feature.layerId === 'routes'
          ? 'route'
          : 'section';
    change({ selected: `${kind}:${feature.id}` });
  };
  // The camera is kept in the address as it moves, without a history entry of its own.
  // It writes onto the address as it is now rather than onto the state last rendered, since a
  // move ends in the same turn as a click that has just changed the address.
  const onCamera = (next: Viewport) => {
    cameraNow.current = next;
    const current = parse(location.hash);
    if (current.screen !== 'map') return;
    history.replaceState(
      null,
      '',
      `${location.pathname}${location.search}${hashOf(readMapQuery(current), next)}`
    );
  };
  const onPoint = (at: [number, number]) => {
    if (!state.layers.includes('heatmap')) return;
    const selected = pointSelection(at);
    setClickZoom({ selected, zoom: cameraNow.current?.zoom ?? WORLD_ZOOM });
    change({ selected });
  };

  const lineName = useCallback(
    (line: LineFeature, kind: 'route' | 'section') =>
      kind === 'section'
        ? ((line.properties.name as string | null) ?? line.id)
        : t('maps.underPointRoute', { number: String(line.properties.number ?? line.id) }),
    [t]
  );
  const hoveredText = useMemo(() => {
    if (hovered === null) return '';
    const section = sections.find((line) => line.id === hovered);
    if (section) return lineName(section, 'section');
    const found = routes.find((line) => line.id === hovered);
    if (found) return lineName(found, 'route');
    return everyActivity.find((a) => a.activityId === hovered)?.name ?? '';
  }, [hovered, sections, routes, everyActivity, lineName]);

  const selectedLine =
    selection && (selection.kind === 'route' || selection.kind === 'section')
      ? (selection.kind === 'section' ? sections : routes).find((line) => line.id === selection.id)
      : undefined;
  const selectedActivity =
    selection?.kind === 'activity'
      ? everyActivity.find((a) => a.activityId === selection.id)
      : undefined;
  const reason = screen?.screen.emptyReason ?? null;
  const unmapped = screen?.screen.unmapped;

  const rangeOptions = RANGES.map((preset) => ({ value: preset, label: t(RANGE_LABELS[preset]) }));
  const bandOptions = BANDS.map((band) => ({
    value: band,
    label: band === 'all' ? t('mapScreen.distanceAny') : bandLabel(band, metric),
  }));
  const available = screen?.screen.availableSportTypes ?? [];
  const familyCounts = (screen?.screen.categoryCounts ?? []).filter((entry) => entry.count > 0);
  const labels = useTableLabels();
  const nameColumns: Column<Row>[] = [
    { key: 'name', header: t('connectPage.columns.name'), clip: true, cell: (row) => row.text },
  ];
  const order = parseOrder(state.sort, ACTIVITY_COLUMNS, ACTIVITY_ORDER);
  const activityRows = orderRows(
    held.activities.map((a) => a as unknown as Activity),
    order,
    (a, column) =>
      column === 'name'
        ? a.name
        : column === 'date'
          ? a.date
          : column === 'sport'
            ? a.sportType
            : a.distance
  );
  const activityColumns: Column<Activity>[] = [
    {
      key: 'date',
      header: t('connectPage.columns.date'),
      sortable: true,
      cell: (a) => isoDay(a.date),
    },
    {
      key: 'name',
      header: t('connectPage.columns.name'),
      sortable: true,
      clip: true,
      cell: (a) => a.name,
    },
    {
      key: 'sport',
      header: <span className="map-visually-hidden">{t('connectPage.columns.sport')}</span>,
      label: t('connectPage.columns.sport'),
      sortable: true,
      cell: (a) => (
        <SportGlyph family={sportMark(a.sportType).family} label={sportName(a.sportType)} />
      ),
    },
    {
      key: 'distance',
      header: t('connectPage.columns.distance'),
      numeric: true,
      sortable: true,
      cell: (a) => km(a.distance),
    },
  ];
  const rowsOf = (lines: readonly LineFeature[], kind: 'route' | 'section'): Row[] =>
    lines.map((line) => ({ id: line.id, text: lineName(line, kind) }));
  const litProps = (id: string) => ({ 'data-lit': id === hovered || undefined });
  const counts: Record<ListKind, number> = {
    activities: held.activities.length,
    routes: held.routes.length,
    sections: held.sections.length,
  };
  const listLabel = (list: ListKind) =>
    list === 'activities'
      ? t('maps.layerActivities')
      : list === 'routes'
        ? t('maps.layerRoutes')
        : t('maps.layerSections');

  // The timeline runs over the days the listed activities span.
  const days = useMemo(() => {
    if (everyActivity.length === 0) return null;
    const dates = everyActivity.map((a) => a.date);
    return { first: Math.min(...dates), last: Math.max(...dates) };
  }, [everyActivity]);
  const dayCount = days ? Math.max(1, Math.round((days.last - days.first) / DAY_SECONDS)) : 1;
  const dayIndex = (day: string | null, otherwise: number) =>
    days && day
      ? Math.min(
          dayCount,
          Math.max(
            0,
            Math.round((Date.parse(`${day}T00:00:00Z`) / 1000 - days.first) / DAY_SECONDS)
          )
        )
      : otherwise;
  const sinceAt = dayIndex(state.since, 0);
  const untilAt = Math.max(sinceAt, dayIndex(state.until, dayCount));
  const dayAt = (index: number) => (days ? isoDay(days.first + index * DAY_SECONDS) : '');
  const marks = useMemo(
    () =>
      days
        ? monthMarks(
            days.first,
            days.last,
            everyActivity.map((a) => a.date)
          )
        : [],
    [days, everyActivity]
  );
  const scrub = (since: number, until: number) => {
    if (!days) return;
    replaceHash({
      ...state,
      since: since <= 0 ? null : dayAt(since),
      until: until >= dayCount ? null : dayAt(until),
      view: cameraNow.current ?? state.view,
    });
  };

  const foldButton = (
    <Button
      id="map-panel-fold"
      size="sm"
      variant="ghost"
      aria-label={t('mapScreen.panelFold')}
      onClick={() => change({ panel: false })}
    >
      −
    </Button>
  );
  const blocked = !screen && listsMapScreen ? 'loading' : reason ? 'reason' : null;

  return (
    <section id="map-screen">
      {state.panel && !selection ? (
        <aside id="map-list" className="map-panel" aria-label={t('maps.layerActivities')}>
          <div className="map-panel-head">
            <h2>{t('maps.layerActivities')}</h2>
            {foldButton}
          </div>
          <div className="map-filters">
            <SearchField
              label={t('connectPage.library.searchLabel')}
              clearLabel={t('connectPage.library.clearSearch')}
              placeholder={t('connectPage.library.searchPlaceholder')}
              value={needle}
              onChange={setNeedle}
            />
            <SegmentedControl
              label={t('connectPage.library.range')}
              value={state.range ?? ('' as RangePreset)}
              options={rangeOptions}
              onChange={(range) => change({ range: state.range === range ? null : range })}
            />
            <ChipGroup label={t('connectPage.library.sportLabel')}>
              {familyCounts.map(({ family, count }) => {
                const name = familyName(family);
                return (
                  <Chip
                    key={family}
                    selected={familyChipOn(state.sports, name, available)}
                    onToggle={() => change({ sports: toggleFamily(state.sports, name, available) })}
                  >
                    {t(`connectPage.families.${family}` as ParseKeys)}
                    <span className="map-chip-count">{String(count)}</span>
                  </Chip>
                );
              })}
            </ChipGroup>
            <SegmentedControl
              label={t('connectPage.columns.distance')}
              value={state.band}
              options={bandOptions}
              onChange={(band) => change({ band })}
            />
          </div>
          <div className="map-list-head">
            <SegmentedControl
              label={t('maps.layers')}
              value={state.list}
              options={LISTS.map((list) => ({
                value: list,
                label: `${listLabel(list)} ${counts[list]}`,
              }))}
              onChange={(list) => change({ list })}
            />
            <p id="map-summary">
              {t('mapScreen.activitySummary', {
                count: screen?.screen.activityCount ?? 0,
                mapped: held.activities.length,
              })}
              {unmapped && unmapped.withoutGps > 0
                ? ` · ${t('mapScreen.unmappedWithoutGps', { count: unmapped.withoutGps })}`
                : ''}
              {unmapped && unmapped.downloading > 0
                ? ` · ${t('mapScreen.unmappedDownloading', { count: unmapped.downloading })}`
                : ''}
            </p>
          </div>
          <div className="map-list-table">
            {state.list === 'activities' ? (
              <DataTable
                label={t('maps.layerActivities')}
                tableId={ACTIVITY_LIST}
                labels={labels}
                columns={activityColumns}
                rows={activityRows}
                rowKey={(a) => a.activityId}
                sort={sortProp(order)}
                onSort={(key) =>
                  change({
                    sort: formatOrder(
                      nextOrder(order, key as ActivityColumn, key === 'date' || key === 'distance'),
                      ACTIVITY_ORDER
                    ),
                  })
                }
                rowProps={(a) => litProps(a.activityId)}
                selectedKey={selectedId}
                onRowHover={(a) => hoverFrom('list')(a ? a.activityId : null)}
                onRowClick={(a) => pick(`activity:${a.activityId}`, [a as unknown as MapActivity])}
                onOpen={(a) => pick(`activity:${a.activityId}`, [a as unknown as MapActivity])}
              />
            ) : (
              <DataTable
                label={listLabel(state.list)}
                tableId={`map-${state.list}`}
                labels={labels}
                columns={nameColumns}
                rows={rowsOf(
                  state.list === 'routes' ? held.routes : held.sections,
                  state.list === 'routes' ? 'route' : 'section'
                )}
                rowKey={(row) => row.id}
                rowProps={(row) => litProps(row.id)}
                selectedKey={selectedId}
                onRowHover={(row) => hoverFrom('list')(row ? row.id : null)}
                onRowClick={(row) => pickLine(row.id)}
                onOpen={(row) => pickLine(row.id)}
              />
            )}
          </div>
        </aside>
      ) : null}
      {!state.panel ? (
        <div className="map-float map-chip">
          <Button id="map-chip" size="sm" variant="ghost" onClick={() => change({ panel: true })}>
            {t('maps.layerActivities')}
            <Badge>{String(held.activities.length)}</Badge>
          </Button>
        </div>
      ) : null}

      <div id="map-stage">
        {!listsMapScreen && !listsRouteLines && !listsSections ? (
          <div id="map-unsupported" className="map-float">
            <ReadNotice error={new ReadError('unsupported', 'map.screen')} />
          </div>
        ) : null}
        <MapPane
          base={base}
          terrain={state.terrain}
          spec={spec}
          camera={camera}
          overlays={overlays}
          minZoom={MIN_ZOOM}
          highlightedIds={highlighted}
          queries={queries}
          onHover={hoverFrom('map')}
          onClick={onClick}
          onPoint={onPoint}
          onCamera={onCamera}
          onView={setView}
          onBox={onBox}
          onEscape={clearArea}
        />
        <output id="map-hover" aria-live="polite">
          {hoveredText}
        </output>
        {blocked ? (
          <div id="map-overlay" role="status">
            {blocked === 'loading' ? (
              <p id="map-loading">{t('mapScreen.loadingHeatmap')}</p>
            ) : reason ? (
              <EmptyReason reason={reason} />
            ) : null}
          </div>
        ) : null}

        <div id="map-layers" className="map-float" role="group" aria-label={t('maps.layers')}>
          <ChipGroup label={t('maps.layers')}>
            {LAYERS.map((layer) => (
              <Chip
                key={layer}
                selected={state.layers.includes(layer)}
                onToggle={() => change({ layers: toggle(state.layers, layer) })}
              >
                {layerLabel(layer)}
              </Chip>
            ))}
          </ChipGroup>
          <SegmentedControl
            label={t('maps.layerActivities')}
            value={state.colour}
            options={COLOURINGS.map((colouring) => ({
              value: colouring,
              label:
                colouring === 'sport' ? t('connectPage.columns.sport') : t('maps.keyRecencyAxis'),
            }))}
            onChange={(colour) => change({ colour })}
          />
          <SegmentedControl
            label={t('maps.toggleStyle')}
            value={base}
            options={BASES.map((choice) => ({
              value: choice,
              label:
                choice === 'satellite'
                  ? t('maps.baseSatellite')
                  : t(`connectPage.settings.options.${choice}`),
            }))}
            onChange={(choice) => change({ base: choice })}
          />
          <ChipGroup label={t('maps.terrain3D')}>
            <Chip selected={state.terrain} onToggle={() => change({ terrain: !state.terrain })}>
              {t('maps.terrain3D')}
            </Chip>
          </ChipGroup>
          <div className="map-actions">
            <Button size="sm" onClick={fitAll}>
              {t('maps.fitAll')}
            </Button>
            {box ? (
              <Button size="sm" variant="ghost" onClick={() => setBox(null)}>
                {t('mapScreen.emptyClearFilters')}
              </Button>
            ) : null}
          </div>
        </div>

        <div id="map-bottom">
          <div id="map-legend" className="map-float" role="group" aria-label={t('maps.layers')}>
            {LAYERS.map((layer) => (
              <Button
                key={layer}
                size="sm"
                variant="ghost"
                aria-pressed={state.layers.includes(layer)}
                onClick={() => change({ layers: toggle(state.layers, layer) })}
              >
                <span
                  className="map-swatch"
                  style={{ background: swatch(layer, pagePalette(base)) }}
                  aria-hidden="true"
                />
                {layerLabel(layer)}
              </Button>
            ))}
            <ul id="map-key" aria-label={t('maps.layerActivities')}>
              {state.colour === 'sport' ? (
                familyCounts.map(({ family }) => {
                  const name = familyName(family);
                  return (
                    <li key={family}>
                      <span
                        className="map-dot"
                        style={{ background: sportFamilyColours[toneOf(base)][name][0] }}
                        aria-hidden="true"
                      />
                      {t(`connectPage.families.${family}` as ParseKeys)}
                    </li>
                  );
                })
              ) : (
                <li className="map-ramp">
                  <span
                    className="map-ramp-bar"
                    style={{ background: ramp(pagePalette(base)) }}
                    aria-hidden="true"
                  />
                  <span className="map-ramp-ends">
                    <span>{t('maps.keyRecent')}</span>
                    <span>{t('maps.keyYearOrMore')}</span>
                  </span>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div id="map-timeline" className="map-float">
          <div className="map-timeline-track">
            <ol className="map-months" aria-hidden="true">
              {marks.map((mark) => (
                <li
                  key={mark.month}
                  data-active={mark.active || undefined}
                  style={{ left: `${mark.position * 100}%` }}
                >
                  <span>{mark.month.slice(5) === '01' ? mark.month.slice(0, 4) : ''}</span>
                </li>
              ))}
            </ol>
            <TextField
              id="map-since"
              type="range"
              label={t('mapScreen.timelineFrom')}
              hideLabel
              min={0}
              max={dayCount}
              step={1}
              value={sinceAt}
              disabled={!days}
              aria-valuetext={dayAt(sinceAt)}
              onChange={(value) => scrub(Math.min(Number(value), untilAt), untilAt)}
            />
            <TextField
              id="map-until"
              type="range"
              label={t('mapScreen.timelineTo')}
              hideLabel
              min={0}
              max={dayCount}
              step={1}
              value={untilAt}
              disabled={!days}
              aria-valuetext={dayAt(untilAt)}
              onChange={(value) => scrub(sinceAt, Math.max(Number(value), sinceAt))}
            />
          </div>
          <output id="map-timeline-day">
            {days ? `${dayAt(sinceAt)} – ${dayAt(untilAt)}` : ''}
          </output>
        </div>
        {selection && state.panel ? (
          <aside id="map-selection" className="map-panel" aria-label={t('maps.layerActivities')}>
            <div className="map-selection-head">
              <Button
                id="map-selection-back"
                size="sm"
                variant="ghost"
                aria-label={t('mapScreen.panelBack')}
                onClick={() => change({ selected: null })}
              >
                ←
              </Button>
              <h2>
                {selection.kind === 'point'
                  ? t('maps.layerActivities')
                  : selectedActivity
                    ? selectedActivity.name
                    : selectedLine
                      ? lineName(selectedLine, selection.kind === 'section' ? 'section' : 'route')
                      : selection.id}
                {selection.kind === 'point' && underPoint ? (
                  <Badge>{String(underPoint.total)}</Badge>
                ) : null}
              </h2>
              {foldButton}
            </div>
            {selection.kind === 'activity' ? (
              <dl id="map-selection-facts">
                {selectedActivity ? (
                  <>
                    <dt>{t('connectPage.columns.date')}</dt>
                    <dd>{isoDay(selectedActivity.date)}</dd>
                    <dt>{t('connectPage.columns.sport')}</dt>
                    <dd>{sportName(selectedActivity.sportType)}</dd>
                    <dt>{t('connectPage.columns.distance')}</dt>
                    <dd>{km(selectedActivity.distance)}</dd>
                    <dt>{t('connectPage.columns.time')}</dt>
                    <dd>{clock(selectedActivity.duration)}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
            {selection.kind === 'section' &&
            typeof selectedLine?.properties.visitCount === 'number' ? (
              <p>
                {t('maps.activitiesCount', {
                  count: selectedLine.properties.visitCount,
                })}
              </p>
            ) : null}
            {selection.kind === 'point' ? (
              <UnderPointList
                answer={underPoint}
                kind={underKind}
                onKind={setUnderKind}
                labels={labels}
                onHover={(id) => hoverFrom('list')(id)}
                onActivity={(id) => change({ selected: `activity:${id}` })}
              />
            ) : (
              <a
                className="map-open"
                href={write({
                  screen: selection.kind,
                  id: selection.id,
                  query: [],
                })}
              >
                {t('maps.viewDetails')}
              </a>
            )}
          </aside>
        ) : null}
      </div>
    </section>
  );
}

type Palette = ReturnType<typeof pagePalette>;

/** The fill a layer's legend entry shows. */
function swatch(layer: Layer, palette: Palette): string {
  switch (layer) {
    case 'heatmap':
      return ramp(palette);
    case 'routes':
      return routePalette[0];
    case 'sections':
      return sectionPalette[0];
    default:
      return palette.start;
  }
}

/** The age colour's ramp, newest first. */
const ramp = (palette: Palette) =>
  `linear-gradient(to right, ${[...palette.heat].reverse().join(', ')})`;

/** The hash a state and camera write. */
function hashOf(state: MapState, camera: Viewport): string {
  return write({ screen: 'map', id: null, query: mapQuery({ ...state, view: camera }) });
}

/** Writes the state to the address in place, and tells the page the address moved. */
function replaceHash(state: MapState) {
  history.replaceState(
    null,
    '',
    `${location.pathname}${location.search}${write({ screen: 'map', id: null, query: mapQuery(state) })}`
  );
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Why the map draws nothing, in the phone's own words. */
function EmptyReason({ reason }: { reason: NonNullable<Screen['screen']['emptyReason']> }) {
  const { t } = useTranslation();
  if (reason === 'noActivities') {
    return (
      <div id="map-empty">
        <h2>{t('mapScreen.emptyNoActivities')}</h2>
        <p>{t('mapScreen.emptyNoActivitiesHint')}</p>
      </div>
    );
  }
  if ('filtered' in reason) {
    return (
      <div id="map-empty">
        <h2>{t('mapScreen.emptyFiltered')}</h2>
        <p>{t('mapScreen.emptyFilteredHint', { count: reason.filtered.mapped })}</p>
      </div>
    );
  }
  if ('tracksPending' in reason) {
    return (
      <div id="map-empty">
        <h2>{t('mapScreen.emptyTracksPending')}</h2>
        <p>{t('mapScreen.emptyTracksPendingHint', { count: reason.tracksPending.pending })}</p>
      </div>
    );
  }
  return (
    <div id="map-empty">
      <h2>{t('mapScreen.emptyNoGps')}</h2>
      <p>{t('mapScreen.emptyNoGpsHint')}</p>
    </div>
  );
}

/** What a click on the heatmap lists: the engine's groups, then its activities, as the kind filter says. */
function UnderPointList({
  answer,
  kind,
  onKind,
  labels,
  onHover,
  onActivity,
}: {
  answer: UnderPointAnswer | null;
  kind: UnderPointKind;
  onKind: (kind: UnderPointKind) => void;
  labels: ReturnType<typeof useTableLabels>;
  onHover: (id: string | null) => void;
  onActivity: (id: string) => void;
}) {
  const { t } = useTranslation();
  const sportName = useSportName();
  if (!answer) return null;
  const options = kindOptions(answer);
  const shown: UnderPointKind = options.some((option) => option.kind === kind) ? kind : 'all';
  const kindLabel: Record<UnderPointKind, string> = {
    all: t('connectPage.library.all'),
    routes: t('maps.layerRoutes'),
    sections: t('maps.layerSections'),
    activities: t('maps.layerActivities'),
  };
  const groups = groupRows(answer, shown);
  const activities = shown === 'routes' || shown === 'sections' ? [] : activityRows(answer);
  const groupName = (group: UnderPointGroup) =>
    group.name ??
    (group.kind === 'route'
      ? t('maps.underPointRoute', { number: String(group.number ?? group.id ?? '') })
      : t('sectionHistory.pairUnnamed'));
  return (
    <>
      {options.length > 0 ? (
        <SegmentedControl
          id="map-under-kind"
          label={t('maps.layerActivities')}
          value={shown}
          options={options.map((option) => ({
            value: option.kind,
            label: `${kindLabel[option.kind]} ${option.count}`,
          }))}
          onChange={onKind}
        />
      ) : null}
      {groups.length > 0 ? (
        <DataTable
          label={t('maps.layerRoutes')}
          labels={labels}
          columns={[
            {
              key: 'name',
              header: t('connectPage.columns.name'),
              clip: true,
              cell: (g: UnderPointGroup) => groupName(g),
            },
            {
              key: 'sport',
              header: t('connectPage.columns.sport'),
              cell: (g: UnderPointGroup) =>
                g.sportTypes.map((sport) => sportName(sport)).join(', '),
            },
            {
              key: 'count',
              header: t('maps.layerActivities'),
              numeric: true,
              cell: (g: UnderPointGroup) => String(g.count),
            },
            {
              key: 'distance',
              header: t('connectPage.columns.distance'),
              numeric: true,
              cell: (g: UnderPointGroup) => km(g.distanceM),
            },
            {
              key: 'passes',
              header: t('connectPage.routes.passes'),
              numeric: true,
              cell: (g: UnderPointGroup) => String(g.passes),
            },
            {
              key: 'best',
              header: t('connectPage.routes.bestTime'),
              numeric: true,
              cell: (g: UnderPointGroup) => (g.bestTime === null ? '' : clock(g.bestTime)),
            },
            {
              key: 'last',
              header: t('connectPage.workouts.colLastDone'),
              cell: (g: UnderPointGroup) => (g.lastDate === null ? '' : isoDay(g.lastDate)),
            },
          ]}
          rows={groups}
          rowKey={(g) => `${g.kind}:${g.id ?? ''}`}
          onRowClick={(g) =>
            g.id === null
              ? undefined
              : navigate({ screen: g.kind as 'route' | 'section', id: g.id, query: [] })
          }
        />
      ) : null}
      {activities.length > 0 ? (
        <DataTable
          label={t('maps.layerActivities')}
          labels={labels}
          columns={[
            {
              key: 'date',
              header: t('connectPage.columns.date'),
              cell: (a: UnderPointActivity) => isoDay(a.date),
            },
            {
              key: 'name',
              header: t('connectPage.columns.name'),
              clip: true,
              cell: (a: UnderPointActivity) => a.name,
            },
            {
              key: 'distance',
              header: t('connectPage.columns.distance'),
              numeric: true,
              cell: (a: UnderPointActivity) => km(a.distance),
            },
            {
              key: 'time',
              header: t('connectPage.columns.time'),
              numeric: true,
              cell: (a: UnderPointActivity) => clock(a.duration),
            },
          ]}
          rows={activities}
          rowKey={(a) => a.id}
          onRowHover={(a) => onHover(a ? a.id : null)}
          onRowClick={(a) => onActivity(a.id)}
        />
      ) : null}
    </>
  );
}
