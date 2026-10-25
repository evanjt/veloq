/**
 * Source and layer specs for the regional map.
 *
 * Clustering is native to the GeoJSON source: `cluster: true` gives back
 * `point_count` and `cluster_id` properties, which the circle and label layers
 * read through filters. Selection state is expressed as a paint expression over
 * the selected id rather than a rebuilt FeatureCollection, so panning with a
 * selection active does not re-upload every point.
 */
import { colourIndexExpression, type MapBase, type MapPalette } from '@/theme';
import type { MapGeoJSONData, MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import { heatmapRasterPaint } from '@/features/maps/lib/heatmapPaint';
import { HEATMAP_SOURCE_MINZOOM, heatmapTileTemplate } from '@/features/maps/lib/heatmapTiles';
import { TRACE_ZOOM_THRESHOLD } from '@/features/maps/lib/mapBudgets';
import {
  MAP_3D_SCALE,
  OVERLAY_EDGE_MARGIN,
  SECTION_LINE_DASH,
  ROUTE_LINE_WIDTHS,
  SECTION_LINE_WIDTHS,
  lineWidthRamp,
} from '@/features/maps/lib/mapLineWidths';
import { BUNDLED_TEXT_FONT } from '@/features/maps/lib/bundledGlyphs';
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
  /** The base map the heatmap is drawn over, whose heat steps its tiles are served in. */
  heatmapBase: MapBase;
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
      tiles: [heatmapTileTemplate(input.heatmapBase, input.heatmapGeneration ?? 0)],
      tileSize: 256,
      minzoom: HEATMAP_SOURCE_MINZOOM,
      maxzoom: 17,
    };
  }

  return sources;
}

interface RegionalLayerInput {
  /** The colours of the base map drawn under the layers, which they are drawn for. */
  palette: MapPalette;
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
  /**
   * The map is tilted over terrain. The layers are the same and every width and
   * radius is drawn at `MAP_3D_SCALE`, nothing else changing.
   */
  terrain?: boolean;
}

export function buildRegionalLayers(input: RegionalLayerInput): MapLayerSpec[] {
  const {
    palette,
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
    terrain = false,
  } = input;
  const { layer } = palette;
  const scale = terrain ? MAP_3D_SCALE : 1;
  const size = (px: number) => px * scale;

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
      paint: heatmapRasterPaint(),
    });
  }

  // No per-activity lines. They were built from route signatures and
  // stride-sampled on top, so the line under a tap never matched the full-
  // coordinate route the tap painted, and the coverage they stood for is what
  // the heatmap draws from disk tiles. The activity points below are what a tap
  // needs, and the clustered source's points sit at each activity's start.
  layers.push(
    // Route lines draw under the section lines. Every route and section line
    // sits on the base's edge, wider than the line, so it separates from the
    // ground, the imagery and the heat under it. The selected one is raised on
    // the casing instead, and the edge under the rest dims with their line.
    {
      id: 'routes-outline',
      type: 'line',
      source: 'routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': selectedRouteId
          ? ['case', isSelectedRoute, palette.casing, palette.edge]
          : palette.edge,
        'line-width': selectedRouteId
          ? ['case', isSelectedRoute, size(7), size(2 + OVERLAY_EDGE_MARGIN)]
          : lineWidthRamp(ROUTE_LINE_WIDTHS, OVERLAY_EDGE_MARGIN, scale),
        'line-opacity': showRoutes
          ? selectedRouteId
            ? ['case', isSelectedRoute, 0.8, 0.5]
            : 1
          : 0,
      },
      visible: showRoutes,
    },
    {
      id: ROUTES_LINE_LAYER_ID,
      type: 'line',
      source: 'routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': colourIndexExpression(layer.routes, ['get', 'palette'], true),
        'line-width': selectedRouteId
          ? ['case', isSelectedRoute, size(5), size(2)]
          : lineWidthRamp(ROUTE_LINE_WIDTHS, 0, scale),
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
        'line-color': selectedSectionId
          ? ['case', isSelectedSection, palette.casing, palette.edge]
          : palette.edge,
        'line-width': selectedSectionId
          ? ['case', isSelectedSection, size(6), size(2 + OVERLAY_EDGE_MARGIN)]
          : lineWidthRamp(SECTION_LINE_WIDTHS, OVERLAY_EDGE_MARGIN, scale),
        'line-opacity': showSections
          ? selectedSectionId
            ? ['case', isSelectedSection, 0.8, 0.55]
            : 1
          : 0,
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
          ? ['case', isSelectedSection, size(4), size(2)]
          : lineWidthRamp(SECTION_LINE_WIDTHS, 0, scale),
        'line-dasharray': [...SECTION_LINE_DASH],
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
      // A sport-coloured line on the Map tab is edged rather than cased. Over
      // the heatmap the line is the base's ink, a highlighted line, and cased.
      paint: {
        'line-color': heatmapDrawn({ enabled: heatmapEnabled, shown: showHeatmap })
          ? palette.casing
          : palette.edge,
        'line-width': size(8),
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
        'line-width': size(5),
        'line-opacity': hasRouteData ? 1 : 0,
      },
    },
    {
      id: CLUSTER_CIRCLE_LAYER_ID,
      type: 'circle',
      source: CLUSTER_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': palette.route,
        'circle-radius': ['step', ['get', 'point_count'], size(20), 10, size(25), 50, size(30)],
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
      paint: { 'text-color': palette.badgeInk },
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
          selectedActivityId ? ['case', isSelectedActivity, size(12), size(5)] : size(5),
          TRACE_ZOOM_THRESHOLD - 1,
          selectedActivityId ? ['case', isSelectedActivity, size(12), size(8)] : size(8),
          TRACE_ZOOM_THRESHOLD,
          selectedActivityId ? ['case', isSelectedActivity, size(12), size(5)] : size(5),
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
        'circle-stroke-width': selectedActivityId
          ? ['case', isSelectedActivity, size(2.5), size(1.5)]
          : size(1.5),
        'circle-stroke-color': selectedActivityId
          ? ['case', isSelectedActivity, palette.ink, layer.pointRing]
          : layer.pointRing,
        'circle-stroke-opacity': showActivities ? 1 : 0,
      },
      visible: showActivities,
    },
    {
      id: 'spider-lines',
      type: 'line',
      source: 'spider-legs',
      paint: {
        'line-color': layer.spiderLeg,
        'line-width': size(1.5),
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
        'circle-radius': size(10),
        'circle-opacity': spiderVisible ? 1 : 0,
        'circle-stroke-width': size(2),
        'circle-stroke-color': palette.casing,
        'circle-stroke-opacity': spiderVisible ? 1 : 0,
      },
      visible: spiderVisible,
    },
    ...buildUserLocationLayers(hasUserLocation, palette, scale)
  );

  return layers;
}

/**
 * Whether the heatmap is drawn on the map. Available in settings is not drawn:
 * the athlete can hide it on the map.
 */
function heatmapDrawn(heatmap: { enabled: boolean; shown: boolean }): boolean {
  return heatmap.enabled && heatmap.shown;
}

/**
 * The selected activity's line colour: its sport colour, or the base map's ink
 * while the heatmap is drawn under it, which is read against the opaque casing
 * drawn for that ink rather than against the heat.
 */
export function selectedRouteColor(
  sportColor: string,
  heatmap: { enabled: boolean; shown: boolean },
  palette: MapPalette
): string {
  return heatmapDrawn(heatmap) ? palette.ink : sportColor;
}
