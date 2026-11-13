// `#/map`: the global map. The heatmap is the engine's own tiles, the route and
// section lines are GeoJSON the engine writes, and the activities, counts and
// empty reasons are the phone's map read. The filters live in the hash, a
// side pane lists what the viewport holds, and a row and its line light each
// other.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';

import type { MapSurfaceSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';
import { routePaletteExpression, sectionPaletteExpression } from '@/theme/colors';

import type { Methods } from '../schema';
import { type Route, write } from '../router';
import { RANGE_LABELS, RANGES, rangeBounds, type RangePreset } from '../table';
import { Badge, Button, Chip, ChipGroup, DataTable, SearchField, SegmentedControl, type Column } from '../ui';
import { MapPane } from './MapPane';
import type { PickedFeature } from './hit';
import type { Ask } from './protocol';
import { baseForScheme, otherBase, pagePalette, type PageBase } from './style';
import {
  BANDS,
  LAYERS,
  bandLabel,
  boundsOfFeatures,
  inView,
  isMetricSetting,
  mapQuery,
  openRef,
  readMapQuery,
  type Box,
  type Layer,
  type LineFeature,
  type MapActivity,
  type MapState,
} from './view';

type Screen = Methods['map.screen']['result'];
type Activity = Screen['screen']['activities'][number];

const WORLD_ZOOM = 2;
/** The heatmap is drawn from zoom 1; the map does not go out past it. */
const MIN_ZOOM = 1;
const HEATMAP_TILE_PX = 512;
const HEATMAP_MAX_ZOOM = 17;
/** How often the pass's progress is read while the map is open. */
const PROGRESS_POLL_MS = 5000;
/** How long typing pauses before the search is asked of the phone. */
const SEARCH_PAUSE_MS = 250;
const DAY_SECONDS = 86_400;

const prefersDark = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** What the spec is built from besides the base. */
export type SpecInput = {
  methods: readonly string[];
  layers: readonly Layer[];
  heatmapVersion: number;
  routesVersion: number | null;
  sectionsVersion: number | null;
  starts: unknown;
};

/** The spec for a base and what the phone lists. A layer that is off stays mounted, hidden. */
export function mapSpec(base: PageBase, input: SpecInput): MapSurfaceSpec {
  const palette = pagePalette(base);
  const sources: MapSurfaceSpec['sources'] = {};
  const layers: MapSurfaceSpec['layers'] = [];
  const interactiveLayers: string[] = [];
  const on = (layer: Layer) => input.layers.includes(layer);
  const lit = ['case', ['boolean', ['feature-state', 'highlighted'], false]];
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
        'line-color': sectionPaletteExpression(),
        'line-width': [...lit, 6, 4],
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
      },
      visible: on('routes'),
    });
    interactiveLayers.push('routes');
  }
  sources.starts = { kind: 'geojson', data: input.starts as never };
  layers.push({
    id: 'starts',
    type: 'circle',
    source: 'starts',
    paint: {
      'circle-radius': [...lit, 7, 4],
      'circle-color': palette.start,
      'circle-stroke-color': palette.casing,
      'circle-stroke-width': 1,
    },
    visible: on('starts'),
  });
  interactiveLayers.unshift('starts');
  return { sources, layers, interactiveLayers };
}

/** The start of each activity that has one, as the points layer draws them. */
export function startPoints(activities: readonly Activity[]) {
  return {
    type: 'FeatureCollection',
    features: activities
      .filter((a) => a.startLat !== null && a.startLng !== null)
      .map((a) => ({
        type: 'Feature',
        id: a.activityId,
        properties: { id: a.activityId },
        geometry: { type: 'Point', coordinates: [a.startLng, a.startLat] },
      })),
  };
}

/** The window the state asks of the phone, in epoch seconds. */
export function windowFor(state: MapState, now: Date): { startDate: number; endDate: number } {
  const { oldestTs, newestTs } = rangeBounds(state.range, now);
  return {
    startDate: oldestTs ?? 0,
    endDate: newestTs ?? Math.floor(now.getTime() / 1000) + DAY_SECONDS,
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

function go(state: MapState) {
  location.hash = write({ screen: 'map', id: null, query: mapQuery(state) });
}

/** Reads one method when `key` changes; the answer is kept until the next one lands. */
function useRead<T>(read: Ask, method: string, params: object, listed: boolean) {
  const text = JSON.stringify(params);
  const [answer, setAnswer] = useState<T | null>(null);
  useEffect(() => {
    if (!listed) return undefined;
    let current = true;
    read(method, JSON.parse(text) as object)
      .then((result) => current && setAnswer(result as T))
      .catch(() => current && setAnswer(null));
    return () => {
      current = false;
    };
  }, [read, method, text, listed]);
  return answer;
}

export function MapScreen({
  read,
  methods,
  route,
}: {
  read: Ask;
  methods: readonly string[];
  route: Route;
}) {
  const { t, i18n } = useTranslation();
  const state = useMemo(() => readMapQuery(route), [route]);
  const [base, setBase] = useState<PageBase>(() => baseForScheme(prefersDark()));
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<Box | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [needle, setNeedle] = useState(state.needle);
  const [heatmapVersion, setHeatmapVersion] = useState(0);
  const [fit, setFit] = useState<Box | null>(null);

  const listsSettings = methods.includes('settings.get');
  const listsMapScreen = methods.includes('map.screen');
  const listsRouteLines = methods.includes('geo.routeLines');
  const listsSections = methods.includes('geo.sections');
  const listsProgress = methods.includes('heatmap.progress');
  const units = useRead<Methods['settings.get']['result']>(
    read,
    'settings.get',
    { keys: ['veloq-resolved-unit-system'] },
    listsSettings
  );
  const metric = isMetricSetting(units?.values.find((v) => v.value !== null)?.value);

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
  const screen = useRead<Screen>(read, 'map.screen', ask, listsMapScreen);
  const routeLines = useRead<Methods['geo.routeLines']['result']>(
    read,
    'geo.routeLines',
    { generation: screen?.routeGeneration ?? null },
    listsRouteLines
  );
  const sectionLines = useRead<Methods['geo.sections']['result']>(
    read,
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
      read('heatmap.progress', {})
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
  }, [read, listsProgress]);

  // The search is asked of the phone once typing pauses.
  useEffect(() => {
    if (needle === state.needle) return undefined;
    const timer = setTimeout(() => go({ ...state, needle }), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [needle, state]);
  // A search the hash changes under the field (back, a link) replaces the draft.
  const [seenNeedle, setSeenNeedle] = useState(state.needle);
  if (seenNeedle !== state.needle) {
    setSeenNeedle(state.needle);
    setNeedle(state.needle);
  }

  const activities = useMemo<Activity[]>(() => screen?.screen.activities ?? [], [screen]);
  const routes = useMemo(() => parseLines(routeLines?.text ?? ''), [routeLines]);
  const sections = useMemo(() => parseLines(sectionLines?.text ?? ''), [sectionLines]);
  const held = useMemo(() => {
    const area = box ?? view;
    const all = { activities: activities as MapActivity[], routes, sections };
    return area ? inView(area, all) : all;
  }, [activities, routes, sections, view, box]);

  const starts = useMemo(() => startPoints(activities), [activities]);
  const spec = useMemo(
    () =>
      mapSpec(base, {
        methods,
        layers: state.layers,
        heatmapVersion,
        routesVersion: screen?.routeGeneration ?? null,
        sectionsVersion: screen?.sectionStamp ?? null,
        starts,
      }),
    [base, methods, state.layers, heatmapVersion, screen?.routeGeneration, screen?.sectionStamp, starts]
  );
  const camera = useMemo(
    () => (fit ? { bounds: fit } : { center: [0, 0] as maplibregl.LngLat, zoom: WORLD_ZOOM }),
    [fit]
  );
  const highlighted = useMemo(() => (hovered === null ? [] : [hovered]), [hovered]);

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
  const change = (next: Partial<MapState>) => go({ ...state, ...next });
  const toggle = <T,>(list: readonly T[], item: T) =>
    list.includes(item) ? list.filter((held) => held !== item) : [...list, item];
  const fitAll = () => setFit(boundsOfFeatures([], activities) ?? null);
  const clearArea = () => {
    if (box) setBox(null);
    else if (state.open) change({ open: null });
  };
  const onBox = (next: Box) => {
    setBox(next);
    setFit(next);
  };
  const onClick = (feature: PickedFeature) => {
    if (feature.id === null) return;
    if (feature.layerId === 'starts') location.hash = write({ screen: 'activity', id: feature.id, query: [] });
    else change({ open: `${feature.layerId === 'routes' ? 'route' : 'section'}:${feature.id}` });
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
    return activities.find((a) => a.activityId === hovered)?.name ?? '';
  }, [hovered, sections, routes, activities, lineName]);

  const opened = openRef(state.open);
  const openedLine = opened
    ? (opened.kind === 'section' ? sections : routes).find((line) => line.id === opened.id)
    : undefined;
  const reason = screen?.screen.emptyReason ?? null;

  const sportName = (sport: string) => (i18n.exists(`activityTypes.${sport}`) ? t(`activityTypes.${sport}` as ParseKeys) : sport);
  const rangeOptions = RANGES.map((preset) => ({ value: preset, label: t(RANGE_LABELS[preset]) }));
  const bandOptions = BANDS.map((band) => ({
    value: band,
    label: band === 'all' ? t('mapScreen.distanceAny') : bandLabel(band, metric),
  }));
  const nameColumn = { key: 'name', header: t('connectPage.columns.name') };
  const activityColumns: Column<Row>[] = [{ ...nameColumn, cell: (row) => row.text }];
  const rowsOf = (lines: readonly LineFeature[], kind: 'route' | 'section'): Row[] =>
    lines.map((line) => ({ id: line.id, text: lineName(line, kind) }));

  return (
    <section id="map-screen">
      <MapPane
        base={base}
        spec={spec}
        camera={camera}
        minZoom={MIN_ZOOM}
        highlightedIds={highlighted}
        read={read}
        onHover={setHovered}
        onClick={onClick}
        onView={setView}
        onBox={onBox}
        onEscape={clearArea}
      />
      <div id="map-filters" className="map-float">
        <SearchField
          label={t('connectPage.library.searchLabel')}
          clearLabel={t('connectPage.library.searchLabel')}
          placeholder={t('connectPage.library.searchPlaceholder')}
          value={needle}
          onChange={setNeedle}
        />
        <div className="map-field">
          <SegmentedControl
            label={t('connectPage.library.range')}
            value={state.range ?? ('' as RangePreset)}
            options={rangeOptions}
            onChange={(range) => change({ range: state.range === range ? null : range })}
          />
        </div>
        <ChipGroup label={t('connectPage.library.sportLabel')}>
          {(screen?.screen.availableSportTypes ?? []).map((sport) => (
            <Chip
              key={sport}
              selected={state.sports.includes(sport)}
              onToggle={() => change({ sports: toggle(state.sports, sport) })}
            >
              {sportName(sport)}
            </Chip>
          ))}
        </ChipGroup>
        <div className="map-field">
          <SegmentedControl
            label={t('mapScreen.distanceAny')}
            value={state.band}
            options={bandOptions}
            onChange={(band) => change({ band })}
          />
        </div>
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
        <div className="map-actions">
          <Button size="sm" onClick={fitAll}>
            {t('maps.fitAll')}
          </Button>
          <Button size="sm" aria-pressed={base !== baseForScheme(prefersDark())} onClick={() => setBase(otherBase(base))}>
            {t('maps.toggleStyle')}
          </Button>
          {box ? (
            <Button size="sm" variant="ghost" onClick={() => setBox(null)}>
              {t('mapScreen.emptyClearFilters')}
            </Button>
          ) : null}
        </div>
        <output id="map-hover" aria-live="polite">
          {hoveredText}
        </output>
      </div>
      <aside id="map-side" className="map-float">
        {reason ? <EmptyReason reason={reason} /> : null}
        {opened && openedLine ? (
          <div id="map-open">
            <h2>{lineName(openedLine, opened.kind)}</h2>
            {opened.kind === 'section' ? (
              <p>{t('maps.activitiesCount', { count: Number(openedLine.properties.visitCount ?? 0) })}</p>
            ) : null}
            <div className="map-actions">
              <a href={write({ screen: opened.kind, id: opened.id, query: [] })}>{t('maps.viewDetails')}</a>
              <Button size="sm" variant="ghost" onClick={() => change({ open: null })}>
                {opened.kind === 'section' ? t('maps.closeSectionCard') : t('maps.closeRouteCard')}
              </Button>
            </div>
          </div>
        ) : null}
        <Results title={t('maps.layerActivities')} count={held.activities.length}>
          <DataTable
            label={t('maps.layerActivities')}
            columns={activityColumns}
            rows={held.activities.map((a) => ({ id: a.activityId, text: (a as unknown as Activity).name }))}
            rowKey={(row) => row.id}
            selectedKey={hovered}
            onRowClick={(row) => {
              location.hash = write({ screen: 'activity', id: row.id, query: [] });
            }}
          />
        </Results>
        <Results title={t('maps.layerRoutes')} count={held.routes.length}>
          <DataTable
            label={t('maps.layerRoutes')}
            columns={activityColumns}
            rows={rowsOf(held.routes, 'route')}
            rowKey={(row) => row.id}
            selectedKey={hovered}
            onRowClick={(row) => change({ open: `route:${row.id}` })}
          />
        </Results>
        <Results title={t('maps.layerSections')} count={held.sections.length}>
          <DataTable
            label={t('maps.layerSections')}
            columns={activityColumns}
            rows={rowsOf(held.sections, 'section')}
            rowKey={(row) => row.id}
            selectedKey={hovered}
            onRowClick={(row) => change({ open: `section:${row.id}` })}
          />
        </Results>
      </aside>
    </section>
  );
}

type Row = { id: string; text: string };

function Results({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="map-list">
      <h3>
        {title} <Badge>{String(count)}</Badge>
      </h3>
      {children}
    </div>
  );
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
