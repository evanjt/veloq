/**
 * Source and layer specs for the activity detail map.
 *
 * Back to front: the matched route overlay, the activity line (solid or
 * gradient), the section portions cut out of that line, the boundary ticks that
 * mark where each portion starts and ends, the section markers, and finally the
 * chart-scrub highlight.
 *
 * Section markers used to be React views anchored with `MarkerView` because the
 * native renderer could not be trusted with a boolean filter. GL JS filters
 * work, so numbered and PR markers now come out of one source split by filter.
 */
import { colors, mapLayerColors, sectionPalette, sectionPaletteExpression, brand } from '@/theme';
import type { MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import { TROPHY_ICON_ID } from '@/features/maps/lib/mapIcons';

export const SECTION_MARKER_LAYER_IDS = ['section-marker-pr-icon', 'section-marker-circle'];

interface ActivityLayerInput {
  routeGeoJSON: GeoJSON.FeatureCollection | GeoJSON.Feature;
  overlayGeoJSON: GeoJSON.FeatureCollection | GeoJSON.Feature;
  overlayHasData: boolean;
  consolidatedPortionsGeoJSON: GeoJSON.FeatureCollection;
  sectionBoundariesGeoJSON: GeoJSON.FeatureCollection;
  sectionMarkersGeoJSON: GeoJSON.FeatureCollection;
  highlightGeoJSON: GeoJSON.Feature<GeoJSON.Point>;
  endpointsGeoJSON: GeoJSON.FeatureCollection;
  sectionCreationLine: GeoJSON.FeatureCollection | GeoJSON.Feature;
  sectionCreationMarkers: GeoJSON.FeatureCollection;
  activityColor: string;
  gradientActive: boolean;
  gradientLineExpression: unknown;
  /** Truthy when the sections tab has overlays to draw. */
  hasSectionOverlays: boolean;
  highlightedSectionId?: string | null;
  hasHighlightPoint: boolean;
  creationMode: boolean;
}

export function buildActivitySources(input: ActivityLayerInput): Record<string, MapSourceSpec> {
  return {
    overlay: { kind: 'geojson', data: input.overlayGeoJSON },
    route: { kind: 'geojson', data: input.routeGeoJSON },
    // A separate source because line-gradient needs line-progress, and that
    // only exists on a source built with lineMetrics.
    'route-gradient': { kind: 'geojson', data: input.routeGeoJSON, lineMetrics: true },
    portions: { kind: 'geojson', data: input.consolidatedPortionsGeoJSON },
    'section-boundaries': { kind: 'geojson', data: input.sectionBoundariesGeoJSON },
    'section-markers': { kind: 'geojson', data: input.sectionMarkersGeoJSON },
    'section-creation-line': { kind: 'geojson', data: input.sectionCreationLine },
    'section-creation-markers': { kind: 'geojson', data: input.sectionCreationMarkers },
    endpoints: { kind: 'geojson', data: input.endpointsGeoJSON },
    highlight: { kind: 'geojson', data: input.highlightGeoJSON },
  };
}

/** Route opacity yields to whatever is drawn on top of it. */
function routeOpacity(hasSectionOverlays: boolean, highlighted: boolean, overlayHasData: boolean) {
  if (hasSectionOverlays) return highlighted ? 0.25 : 0.8;
  return overlayHasData ? 0.85 : 1;
}

export function buildActivityLayers(input: ActivityLayerInput): MapLayerSpec[] {
  const {
    activityColor,
    gradientActive,
    gradientLineExpression,
    hasSectionOverlays,
    highlightedSectionId,
    hasHighlightPoint,
    overlayHasData,
    creationMode,
  } = input;

  const highlighted = !!highlightedSectionId;
  const isHighlightedSection = ['==', ['get', 'id'], highlightedSectionId ?? ''];
  const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
  const lineOpacity = routeOpacity(hasSectionOverlays, highlighted, overlayHasData);
  const portionColor = [
    'case',
    ['==', ['get', 'isPR'], true],
    mapLayerColors.personalRecord,
    sectionPaletteExpression(),
  ];

  return [
    {
      id: 'overlay-line',
      type: 'line',
      source: 'overlay',
      layout: roundLine,
      paint: { 'line-color': mapLayerColors.highlight, 'line-width': 5, 'line-opacity': 0.5 },
    },
    {
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: roundLine,
      paint: {
        'line-color': mapLayerColors.casing,
        'line-width': 5,
        'line-opacity': lineOpacity,
      },
    },
    {
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: roundLine,
      paint: {
        'line-color': activityColor,
        'line-width': 4,
        // The solid line gives way entirely when gradient colouring is on.
        'line-opacity': gradientActive ? 0 : lineOpacity,
      },
    },
    {
      id: 'route-gradient-line',
      type: 'line',
      source: 'route-gradient',
      layout: roundLine,
      paint: {
        'line-color': activityColor,
        'line-width': 4,
        'line-opacity': gradientActive ? 1 : 0,
        ...(gradientActive && gradientLineExpression
          ? { 'line-gradient': gradientLineExpression }
          : {}),
      },
    },
    {
      id: 'portion-casing',
      type: 'line',
      source: 'portions',
      layout: roundLine,
      paint: {
        'line-color': mapLayerColors.casing,
        'line-width': highlighted ? ['case', isHighlightedSection, 7, 5] : 6,
        'line-opacity': hasSectionOverlays
          ? highlighted
            ? ['case', isHighlightedSection, 1, 0.15]
            : 0.9
          : 0,
      },
    },
    {
      id: 'portion-line',
      type: 'line',
      source: 'portions',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': highlighted
          ? ['case', isHighlightedSection, mapLayerColors.highlight, portionColor]
          : portionColor,
        'line-width': highlighted ? ['case', isHighlightedSection, 5, 3] : 4,
        // Dashed so overlapping portions let each other's colour show through.
        'line-dasharray': [2, 1.2],
        'line-opacity': hasSectionOverlays
          ? highlighted
            ? ['case', isHighlightedSection, 1, 0.25]
            : 0.95
          : 0,
      },
    },
    {
      id: 'section-boundary-casing',
      type: 'line',
      source: 'section-boundaries',
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': mapLayerColors.boundaryCasing,
        'line-width': 6,
        'line-opacity': 0.45,
      },
    },
    {
      id: 'section-boundary-line',
      type: 'line',
      source: 'section-boundaries',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': mapLayerColors.casing, 'line-width': 3.5 },
    },
    {
      id: 'endpoint-border',
      type: 'circle',
      source: 'endpoints',
      paint: { 'circle-radius': 7.5, 'circle-color': mapLayerColors.casing },
    },
    {
      id: 'endpoint-fill',
      type: 'circle',
      source: 'endpoints',
      paint: {
        'circle-radius': 6,
        'circle-color': [
          'case',
          ['==', ['get', 'position'], 'start'],
          mapLayerColors.start,
          mapLayerColors.end,
        ],
      },
    },
    {
      id: 'section-creation-line',
      type: 'line',
      source: 'section-creation-line',
      layout: roundLine,
      paint: {
        'line-color': colors.success,
        'line-width': 6,
        'line-opacity': creationMode ? 1 : 0,
      },
    },
    {
      id: 'section-creation-marker',
      type: 'circle',
      source: 'section-creation-markers',
      paint: {
        'circle-radius': 11,
        'circle-color': [
          'case',
          ['==', ['get', 'position'], 'start'],
          mapLayerColors.startSolid,
          mapLayerColors.endSolid,
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': mapLayerColors.casing,
        'circle-opacity': creationMode ? 1 : 0,
        'circle-stroke-opacity': creationMode ? 1 : 0,
      },
    },
    {
      id: 'section-creation-marker-icon',
      type: 'symbol',
      source: 'section-creation-markers',
      layout: {
        'text-field': ['case', ['==', ['get', 'position'], 'start'], '▶', '■'],
        'text-size': 10,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': colors.textOnDark, 'text-opacity': creationMode ? 1 : 0 },
      visible: creationMode,
    },
    {
      id: 'section-marker-border',
      type: 'circle',
      source: 'section-markers',
      filter: ['!=', ['get', 'isPR'], true],
      paint: { 'circle-radius': 14, 'circle-color': mapLayerColors.casing },
    },
    {
      id: 'section-marker-circle',
      type: 'circle',
      source: 'section-markers',
      filter: ['!=', ['get', 'isPR'], true],
      paint: {
        'circle-radius': 12,
        'circle-color': sectionPaletteExpression(),
        'circle-stroke-width': 2,
        'circle-stroke-color': mapLayerColors.casing,
      },
    },
    {
      id: 'section-marker-label',
      type: 'symbol',
      source: 'section-markers',
      filter: ['!=', ['get', 'isPR'], true],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': colors.textOnDark },
    },
    {
      id: 'section-marker-pr-icon',
      type: 'symbol',
      source: 'section-markers',
      filter: ['==', ['get', 'isPR'], true],
      layout: {
        'icon-image': TROPHY_ICON_ID,
        'icon-size': 0.2,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
      },
      paint: { 'icon-color': brand.gold },
    },
    {
      id: 'highlight-border',
      type: 'circle',
      source: 'highlight',
      paint: {
        'circle-radius': 7,
        'circle-color': mapLayerColors.casing,
        'circle-opacity': hasHighlightPoint ? 1 : 0,
      },
    },
    {
      id: 'highlight-fill',
      type: 'circle',
      source: 'highlight',
      paint: {
        'circle-radius': 5,
        'circle-color': sectionPalette[0],
        'circle-opacity': hasHighlightPoint ? 1 : 0,
      },
    },
  ];
}

/**
 * Fullscreen draws the section portions over BaseMapView's own route line and
 * marks the PR sections, without the numbered badges or the creation overlays.
 */
export function buildFullscreenSectionSources(
  portions: GeoJSON.FeatureCollection,
  prMarkers: GeoJSON.FeatureCollection
): Record<string, MapSourceSpec> {
  return {
    portions: { kind: 'geojson', data: portions },
    'pr-markers': { kind: 'geojson', data: prMarkers },
  };
}

export function buildFullscreenSectionLayers(hasSectionOverlays: boolean): MapLayerSpec[] {
  return [
    {
      id: 'fullscreen-portion-casing',
      type: 'line',
      source: 'portions',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': mapLayerColors.casing,
        'line-width': 6,
        'line-opacity': hasSectionOverlays ? 0.9 : 0,
      },
    },
    {
      id: 'fullscreen-portion-line',
      type: 'line',
      source: 'portions',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'isPR'], true],
          mapLayerColors.personalRecord,
          sectionPaletteExpression(),
        ],
        'line-width': 4,
        'line-opacity': hasSectionOverlays ? 1 : 0,
      },
    },
    {
      id: 'fullscreen-pr-icon',
      type: 'symbol',
      source: 'pr-markers',
      layout: {
        'icon-image': TROPHY_ICON_ID,
        'icon-size': 0.18,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
      },
      paint: { 'icon-color': brand.gold },
    },
  ];
}

export const FULLSCREEN_SECTION_MARKER_LAYER_IDS = ['fullscreen-pr-icon'];
