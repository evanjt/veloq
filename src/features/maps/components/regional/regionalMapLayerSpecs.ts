/**
 * Source and layer specs for the regional map.
 *
 * Clustering is native to the GeoJSON source: `cluster: true` gives back
 * `point_count` and `cluster_id` properties, which the circle and label layers
 * read through filters. Selection state is expressed as a paint expression over
 * the selected id rather than a rebuilt FeatureCollection, so panning with a
 * selection active does not re-upload every point.
 */
import { brand, colors, mapLayerColors } from '@/theme';
import type { MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import { HEATMAP_TILE_PROTOCOL_URL } from '@/features/maps/hooks/useHeatmapTiles';
import { TRACE_ZOOM_THRESHOLD } from '@/features/maps/lib/mapBudgets';

export const CLUSTER_SOURCE_ID = 'activity-clusters';
export const CLUSTER_CIRCLE_LAYER_ID = 'cluster-circles';
export const UNCLUSTERED_POINT_LAYER_ID = 'unclustered-point';
export const SPIDER_POINT_LAYER_ID = 'spider-points';
export const SECTIONS_LINE_LAYER_ID = 'sections-line';

/** Tap precedence: the fanned-out markers sit above everything else. */
export const REGIONAL_INTERACTIVE_LAYERS = [
  SPIDER_POINT_LAYER_ID,
  CLUSTER_CIRCLE_LAYER_ID,
  UNCLUSTERED_POINT_LAYER_ID,
  SECTIONS_LINE_LAYER_ID,
];

/** Unclustered points only appear once the view is tight enough to read them. */
const UNCLUSTERED_MIN_ZOOM = 10;

interface RegionalSourceInput {
  markersGeoJSON: GeoJSON.FeatureCollection;
  tracesGeoJSON: GeoJSON.FeatureCollection;
  startPointsGeoJSON: GeoJSON.FeatureCollection;
  sectionsGeoJSON: GeoJSON.FeatureCollection;
  userLocationGeoJSON: GeoJSON.FeatureCollection;
  routeGeoJSON: GeoJSON.FeatureCollection | GeoJSON.Feature;
  spiderPointsGeoJSON: GeoJSON.FeatureCollection;
  spiderLinesGeoJSON: GeoJSON.FeatureCollection;
  heatmapEnabled: boolean;
}

export function buildRegionalSources(input: RegionalSourceInput): Record<string, MapSourceSpec> {
  const sources: Record<string, MapSourceSpec> = {
    [CLUSTER_SOURCE_ID]: {
      kind: 'geojson',
      data: input.markersGeoJSON,
      cluster: true,
      clusterRadius: 50,
      clusterMaxZoom: 14,
    },
    'activity-traces': { kind: 'geojson', data: input.tracesGeoJSON },
    'activity-start-points': { kind: 'geojson', data: input.startPointsGeoJSON },
    sections: { kind: 'geojson', data: input.sectionsGeoJSON },
    'selected-route': { kind: 'geojson', data: input.routeGeoJSON },
    'spider-legs': { kind: 'geojson', data: input.spiderLinesGeoJSON },
    'spider-markers': { kind: 'geojson', data: input.spiderPointsGeoJSON },
    'user-location': { kind: 'geojson', data: input.userLocationGeoJSON },
  };

  if (input.heatmapEnabled) {
    sources['heatmap-tiles'] = {
      kind: 'raster',
      tiles: [HEATMAP_TILE_PROTOCOL_URL],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 17,
    };
  }

  return sources;
}

interface RegionalLayerInput {
  isDark: boolean;
  mapStyle: 'light' | 'dark' | 'satellite';
  showActivities: boolean;
  showSections: boolean;
  showHeatmap: boolean;
  heatmapEnabled: boolean;
  hasSpider: boolean;
  hasUserLocation: boolean;
  hasRouteData: boolean;
  selectedActivityId: string | null;
  selectedSectionId: string | null;
  /** Line colour for the selected activity's route. */
  routeColor: string;
}

export function buildRegionalLayers(input: RegionalLayerInput): MapLayerSpec[] {
  const {
    isDark,
    mapStyle,
    showActivities,
    showSections,
    showHeatmap,
    heatmapEnabled,
    hasSpider,
    hasUserLocation,
    hasRouteData,
    selectedActivityId,
    selectedSectionId,
    routeColor,
  } = input;

  const isSelectedActivity = ['==', ['get', 'id'], selectedActivityId ?? ''];
  const isSelectedSection = ['==', ['get', 'id'], selectedSectionId ?? ''];
  const isLight = mapStyle === 'light';
  const spiderVisible = hasSpider && showActivities;
  const layers: MapLayerSpec[] = [];

  // Heatmap sits under everything so markers stay readable over it.
  if (heatmapEnabled) {
    layers.push({
      id: 'heatmap-layer',
      type: 'raster',
      source: 'heatmap-tiles',
      paint: {
        'raster-opacity': showHeatmap ? (isLight ? 0.92 : 0.72) : 0,
        'raster-contrast': isLight ? 0.45 : 0,
        'raster-brightness-max': isLight ? 0.55 : 1,
        'raster-saturation': isLight ? 0.6 : 0,
        'raster-resampling': 'linear',
        'raster-fade-duration': 0,
      },
    });
  }

  layers.push(
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
      id: 'start-point-outer',
      type: 'circle',
      source: 'activity-start-points',
      // Start points are noise until the view is tight enough to show traces.
      layout: { visibility: showActivities ? 'visible' : 'none' },
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          TRACE_ZOOM_THRESHOLD - 0.01,
          0,
          TRACE_ZOOM_THRESHOLD,
          5,
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': showActivities ? 0.9 : 0,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': mapLayerColors.casing,
        'circle-stroke-opacity': showActivities ? 1 : 0,
      },
      visible: showActivities,
    },
    {
      id: 'selected-route-outline',
      type: 'line',
      source: 'selected-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': 'rgba(0, 0, 0, 0.4)',
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
        'circle-color': colors.primary,
        'circle-radius': ['step', ['get', 'point_count'], 20, 10, 25, 50, 30],
        'circle-opacity': showActivities ? 0.8 : 0,
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
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': colors.textOnDark },
      visible: showActivities,
    },
    {
      id: UNCLUSTERED_POINT_LAYER_ID,
      type: 'circle',
      source: CLUSTER_SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          UNCLUSTERED_MIN_ZOOM - 0.01,
          0,
          UNCLUSTERED_MIN_ZOOM,
          selectedActivityId ? ['case', isSelectedActivity, 12, 8] : 8,
        ],
        // Recency fade: recent activities full opacity, 1+ year old at 35%
        'circle-opacity': showActivities
          ? ['interpolate', ['linear'], ['get', 'age'], 0, 1, 1, 0.35]
          : 0,
        'circle-stroke-width': selectedActivityId ? ['case', isSelectedActivity, 2.5, 1.5] : 1.5,
        'circle-stroke-color': selectedActivityId
          ? ['case', isSelectedActivity, colors.primary, 'rgba(255, 255, 255, 0.8)']
          : 'rgba(255, 255, 255, 0.8)',
        'circle-stroke-opacity': showActivities ? 1 : 0,
      },
      visible: showActivities,
    },
    {
      id: 'spider-lines',
      type: 'line',
      source: 'spider-legs',
      paint: {
        'line-color': isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.3)',
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
    {
      id: 'user-location-outer',
      type: 'circle',
      source: 'user-location',
      paint: {
        'circle-radius': 12,
        'circle-color': colors.primary,
        'circle-opacity': hasUserLocation ? 0.3 : 0,
      },
    },
    {
      id: 'user-location-inner',
      type: 'circle',
      source: 'user-location',
      paint: {
        'circle-radius': 6,
        'circle-color': colors.primary,
        'circle-opacity': hasUserLocation ? 1 : 0,
        'circle-stroke-width': 2,
        'circle-stroke-color': colors.textOnDark,
      },
    }
  );

  return layers;
}

/** Fallback colour for the selected route line when the heatmap washes out sport colours. */
export const HEATMAP_ROUTE_COLOR = brand.tealLight;
