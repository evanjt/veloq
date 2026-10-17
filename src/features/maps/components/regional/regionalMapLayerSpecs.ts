/**
 * Source and layer specs for the regional map.
 *
 * Clustering is native to the GeoJSON source: `cluster: true` gives back
 * `point_count` and `cluster_id` properties, which the circle and label layers
 * read through filters. Selection state is expressed as a paint expression over
 * the selected id rather than a rebuilt FeatureCollection, so panning with a
 * selection active does not re-upload every point.
 */
import {
  colors,
  colorWithOpacity,
  ink,
  mapLayerColors,
  opacity,
  routePaletteExpression,
} from '@/theme';
import type { MapGeoJSONData, MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import { heatmapRasterPaint } from '@/features/maps/lib/heatmapPaint';
import { HEATMAP_SOURCE_MINZOOM, heatmapTileTemplate } from '@/features/maps/lib/heatmapTiles';
import { TRACE_ZOOM_THRESHOLD } from '@/features/maps/lib/mapBudgets';
import { BUNDLED_TEXT_FONT } from '@/features/maps/lib/bundledGlyphs';
import { isDarkStyle } from '../mapStyles';
import {
  USER_LOCATION_SOURCE_ID,
  buildUserLocationLayers,
} from '@/features/maps/lib/userLocationLayer';

export const CLUSTER_SOURCE_ID = 'activity-clusters';
export const CLUSTER_CIRCLE_LAYER_ID = 'cluster-circles';
export const UNCLUSTERED_POINT_LAYER_ID = 'unclustered-point';
export const SPIDER_POINT_LAYER_ID = 'spider-points';
export const SECTIONS_LINE_LAYER_ID = 'sections-line';
export const ROUTES_LINE_LAYER_ID = 'routes-line';

/**
 * An activity dot's opacity by age in years, 0 today and 1 at a year or more:
 * full when new, fading linearly to the faintest at a year. The map key draws
 * the same fade.
 */
export const RECENCY_FADE = { newest: 1, oldest: 0.35 } as const;

/**
 * Tap precedence: the fanned-out markers sit above everything else, and the
 * route lines, drawn under the sections, come last.
 */
export const REGIONAL_INTERACTIVE_LAYERS = [
  SPIDER_POINT_LAYER_ID,
  CLUSTER_CIRCLE_LAYER_ID,
  UNCLUSTERED_POINT_LAYER_ID,
  SECTIONS_LINE_LAYER_ID,
  ROUTES_LINE_LAYER_ID,
];

interface RegionalSourceInput {
  markersGeoJSON: GeoJSON.FeatureCollection;
  sectionsGeoJSON: GeoJSON.FeatureCollection;
  /**
   * The route lines, as the engine's URL for the layer or empty while the layer is off.
   * The source stays declared either way.
   */
  routesGeoJSON: MapGeoJSONData;
  userLocationGeoJSON: GeoJSON.FeatureCollection;
  /** The selected activity's line, or the engine's URL for it. */
  routeGeoJSON: MapGeoJSONData;
  spiderPointsGeoJSON: GeoJSON.FeatureCollection;
  spiderLinesGeoJSON: GeoJSON.FeatureCollection;
  heatmapEnabled: boolean;
  /** How many tile passes have finished, which versions the source's URL. */
  heatmapGeneration?: number;
}

export function buildRegionalSources(input: RegionalSourceInput): Record<string, MapSourceSpec> {
  const sources: Record<string, MapSourceSpec> = {
    [CLUSTER_SOURCE_ID]: {
      kind: 'geojson',
      data: input.markersGeoJSON,
      cluster: true,
      clusterRadius: 50,
      // The cluster resolves into the activities' own points at
      // `TRACE_ZOOM_THRESHOLD`. Clustering to 14 drew the count over the very
      // points it stood for from 11 up.
      clusterMaxZoom: TRACE_ZOOM_THRESHOLD - 1,
    },
    sections: { kind: 'geojson', data: input.sectionsGeoJSON },
    routes: { kind: 'geojson', data: input.routesGeoJSON },
    'selected-route': { kind: 'geojson', data: input.routeGeoJSON },
    'spider-legs': { kind: 'geojson', data: input.spiderLinesGeoJSON },
    'spider-markers': { kind: 'geojson', data: input.spiderPointsGeoJSON },
    [USER_LOCATION_SOURCE_ID]: { kind: 'geojson', data: input.userLocationGeoJSON },
  };

  if (input.heatmapEnabled) {
    sources['heatmap-tiles'] = {
      kind: 'raster',
      tiles: [heatmapTileTemplate(input.heatmapGeneration ?? 0)],
      tileSize: 256,
      minzoom: HEATMAP_SOURCE_MINZOOM,
      maxzoom: 17,
    };
  }

  return sources;
}

interface RegionalLayerInput {
  mapStyle: 'light' | 'dark' | 'satellite';
  showActivities: boolean;
  showSections: boolean;
  showRoutes: boolean;
  showHeatmap: boolean;
  heatmapEnabled: boolean;
  hasSpider: boolean;
  hasUserLocation: boolean;
  hasRouteData: boolean;
  selectedActivityId: string | null;
  selectedSectionId: string | null;
  selectedRouteId?: string | null;
  /** Line colour for the selected activity's route. */
  routeColor: string;
}

export function buildRegionalLayers(input: RegionalLayerInput): MapLayerSpec[] {
  const {
    mapStyle,
    showActivities,
    showSections,
    showRoutes,
    showHeatmap,
    heatmapEnabled,
    hasSpider,
    hasUserLocation,
    hasRouteData,
    selectedActivityId,
    selectedSectionId,
    selectedRouteId,
    routeColor,
  } = input;
  // The lines are drawn for the base under them, never for the app theme.
  const isDark = isDarkStyle(mapStyle);

  const isSelectedActivity = ['==', ['get', 'id'], selectedActivityId ?? ''];
  const isSelectedSection = ['==', ['get', 'id'], selectedSectionId ?? ''];
  const isSelectedRoute = ['==', ['get', 'id'], selectedRouteId ?? ''];
  const spiderVisible = hasSpider && showActivities;
  const layers: MapLayerSpec[] = [];

  // Heatmap sits under everything so markers stay readable over it.
  //
  // Hidden through `visible`, the way every other layer here is, never with a
  // zero opacity: a raster layer at zero opacity is still visible as far as
  // MapLibre is concerned, so it requests every tile in the viewport and paints
  // them invisibly. The source stays declared either way.
  if (heatmapEnabled) {
    layers.push({
      id: 'heatmap-layer',
      type: 'raster',
      source: 'heatmap-tiles',
      visible: showHeatmap,
      paint: heatmapRasterPaint(mapStyle),
    });
  }

  // No per-activity lines. They were built from route signatures and
  // stride-sampled on top, so the line under a tap never matched the full-
  // coordinate route the tap painted, and the coverage they stood for is what
  // the heatmap draws from disk tiles. The activity points below are what a tap
  // needs, and the clustered source's points sit at each activity's start.
  layers.push(
    // Route lines draw under the section lines. The selected route is raised
    // on a casing, the way the selected section is.
    {
      id: 'routes-outline',
      type: 'line',
      source: 'routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapLayerColors.casing,
        'line-width': selectedRouteId ? ['case', isSelectedRoute, 7, 0] : 0,
        'line-opacity': selectedRouteId && showRoutes ? 0.8 : 0,
      },
      visible: showRoutes,
    },
    {
      id: ROUTES_LINE_LAYER_ID,
      type: 'line',
      source: 'routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': routePaletteExpression(),
        'line-width': selectedRouteId
          ? ['case', isSelectedRoute, 5, 2]
          : ['interpolate', ['linear'], ['zoom'], 6, 1.5, 12, 2.5, 18, 4],
        'line-opacity': showRoutes
          ? selectedRouteId
            ? ['case', isSelectedRoute, 1, 0.5]
            : 0.8
          : 0,
      },
      visible: showRoutes,
    },
    {
      id: 'sections-outline',
      type: 'line',
      source: 'sections',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapLayerColors.casing,
        'line-width': selectedSectionId ? ['case', isSelectedSection, 6, 0] : 0,
        'line-opacity': selectedSectionId && showSections ? 0.8 : 0,
      },
    },
    {
      id: SECTIONS_LINE_LAYER_ID,
      type: 'line',
      source: 'sections',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': selectedSectionId
          ? ['case', isSelectedSection, 4, 2]
          : ['interpolate', ['linear'], ['zoom'], 6, 1.2, 10, 1.8, 14, 2.4, 18, 3.2],
        'line-dasharray': [2, 1.2],
        'line-opacity': showSections
          ? selectedSectionId
            ? ['case', isSelectedSection, 1, 0.55]
            : 0.95
          : 0,
      },
    },
    {
      id: 'selected-route-outline',
      type: 'line',
      source: 'selected-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ink.black,
        'line-width': 8,
        'line-opacity': hasRouteData ? 1 : 0,
      },
    },
    {
      id: 'selected-route-line',
      type: 'line',
      source: 'selected-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': routeColor,
        'line-width': 5,
        'line-opacity': hasRouteData ? 1 : 0,
      },
    },
    {
      id: CLUSTER_CIRCLE_LAYER_ID,
      type: 'circle',
      source: CLUSTER_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': colors.actionPrimary,
        'circle-radius': ['step', ['get', 'point_count'], 20, 10, 25, 50, 30],
        // Opaque, so the count's contrast holds over any basemap beneath it.
        'circle-opacity': showActivities ? 1 : 0,
      },
      visible: showActivities,
    },
    {
      id: 'cluster-count',
      type: 'symbol',
      source: CLUSTER_SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': BUNDLED_TEXT_FONT,
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': colors.textOnFill },
      visible: showActivities,
    },
    {
      id: UNCLUSTERED_POINT_LAYER_ID,
      type: 'circle',
      source: CLUSTER_SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['get', 'color'],
        // One dot per activity at every zoom: the point sits at the activity's
        // start, below the cluster handover it is a ride with no neighbour to
        // cluster with, and from it up every activity is one.
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          selectedActivityId ? ['case', isSelectedActivity, 12, 5] : 5,
          TRACE_ZOOM_THRESHOLD - 1,
          selectedActivityId ? ['case', isSelectedActivity, 12, 8] : 8,
          TRACE_ZOOM_THRESHOLD,
          selectedActivityId ? ['case', isSelectedActivity, 12, 5] : 5,
        ],
        'circle-opacity': showActivities
          ? [
              'interpolate',
              ['linear'],
              ['get', 'age'],
              0,
              RECENCY_FADE.newest,
              1,
              RECENCY_FADE.oldest,
            ]
          : 0,
        'circle-stroke-width': selectedActivityId ? ['case', isSelectedActivity, 2.5, 1.5] : 1.5,
        'circle-stroke-color': selectedActivityId
          ? ['case', isSelectedActivity, colors.actionPrimary, colorWithOpacity(ink.white, 0.8)]
          : colorWithOpacity(ink.white, 0.8),
        'circle-stroke-opacity': showActivities ? 1 : 0,
      },
      visible: showActivities,
    },
    {
      id: 'spider-lines',
      type: 'line',
      source: 'spider-legs',
      paint: {
        'line-color': isDark
          ? colorWithOpacity(ink.white, opacity.disabled)
          : colorWithOpacity(ink.black, opacity.tint4),
        'line-width': 1.5,
        'line-opacity': spiderVisible ? 1 : 0,
      },
      visible: spiderVisible,
    },
    {
      id: SPIDER_POINT_LAYER_ID,
      type: 'circle',
      source: 'spider-markers',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': 10,
        'circle-opacity': spiderVisible ? 1 : 0,
        'circle-stroke-width': 2,
        'circle-stroke-color': mapLayerColors.casing,
        'circle-stroke-opacity': spiderVisible ? 1 : 0,
      },
      visible: spiderVisible,
    },
    ...buildUserLocationLayers(hasUserLocation)
  );

  return layers;
}

/**
 * Fallback colour for the selected route line while the heatmap is drawn under
 * it. Light and outside the teal family, it is read against the opaque casing
 * rather than the heat.
 */
export const HEATMAP_ROUTE_COLOR = ink.white;

/**
 * The selected activity's line colour: its sport colour, or the fallback while
 * the heatmap is drawn under it. Available in settings is not drawn: the
 * athlete can hide it on the map.
 */
export function selectedRouteColor(
  sportColor: string,
  heatmap: { enabled: boolean; shown: boolean }
): string {
  return heatmap.enabled && heatmap.shown ? HEATMAP_ROUTE_COLOR : sportColor;
}
