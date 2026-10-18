/**
 * Source and layer specs for the activity detail map.
 *
 * Back to front: the matched route overlay, the activity line
 * (solid or gradient), the section portions cut out of that line, the ticks that
 * mark where each portion starts and ends, the section markers, and finally
 * the chart-scrub highlight.
 *
 * Section markers used to be React views anchored with `MarkerView` because the
 * native renderer could not be trusted with a boolean filter. GL JS filters
 * work, so numbered and PR markers now come out of one source split by filter.
 */
import type { MapPalette } from '@/theme';
import type { MapGeoJSONData, MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import {
  SECTION_END_ICON_ID,
  SECTION_START_ICON_ID,
  TROPHY_ICON_ID,
} from '@/features/maps/lib/mapIcons';
import {
  sectionCreationLinePaint,
  sectionCreationMarkerPaint,
} from '@/features/maps/lib/sectionCreationPaint';
import { buildEndpointLayers } from '@/features/maps/lib/endpointLayers';
import { BUNDLED_TEXT_FONT } from '@/features/maps/lib/bundledGlyphs';
import { EMPTY_FEATURE_COLLECTION } from '@/features/maps/lib/coordinates';
import {
  USER_LOCATION_SOURCE_ID,
  buildUserLocationLayers,
} from '@/features/maps/lib/userLocationLayer';

export const SECTION_MARKER_LAYER_IDS = ['section-marker-pr-icon', 'section-marker-circle'];

// The matched route runs under the activity track, often within a metre of it.
// It is context, so it takes the base's muted colour and no casing, and it is
// wider than the track above it so a margin of it shows on either side.
const OVERLAY_LINE_WIDTH = 8;

interface ActivitySourceInput {
  /** The activity line, or the engine's URL for it when the engine holds the track. */
  routeGeoJSON: MapGeoJSONData;
  overlayGeoJSON: GeoJSON.FeatureCollection | GeoJSON.Feature;
  consolidatedPortionsGeoJSON: GeoJSON.FeatureCollection;
  sectionBoundariesGeoJSON: GeoJSON.FeatureCollection;
  sectionMarkersGeoJSON: GeoJSON.FeatureCollection;
  highlightGeoJSON: GeoJSON.Feature<GeoJSON.Point>;
  endpointsGeoJSON: GeoJSON.FeatureCollection;
  sectionCreationLine: GeoJSON.FeatureCollection | GeoJSON.Feature;
  sectionCreationMarkers: GeoJSON.FeatureCollection;
  userLocationGeoJSON: GeoJSON.FeatureCollection;
}

interface ActivityLayerInput {
  /** The colours of the base map drawn under the layers. */
  palette: MapPalette;
  overlayHasData: boolean;
  gradientActive: boolean;
  gradientLineExpression: unknown;
  /** Truthy when the sections tab has overlays to draw. */
  hasSectionOverlays: boolean;
  highlightedSectionId?: string | null | undefined;
  hasHighlightPoint: boolean;
  creationMode: boolean;
  hasUserLocation: boolean;
}

type GeoJSONData = GeoJSON.FeatureCollection | GeoJSON.Feature;

// The surface patcher compares each source by identity, so a wrapper is made
// once per data object. A scrub then re-serialises the highlight alone rather
// than the whole track. A URL is compared by value, so it needs no cache.
const plainSpecs = new WeakMap<GeoJSONData, MapSourceSpec>();
const lineMetricSpecs = new WeakMap<GeoJSONData, MapSourceSpec>();

function geojsonSource(data: MapGeoJSONData, lineMetrics = false): MapSourceSpec {
  if (typeof data === 'string') {
    return lineMetrics ? { kind: 'geojson', data, lineMetrics: true } : { kind: 'geojson', data };
  }
  const cache = lineMetrics ? lineMetricSpecs : plainSpecs;
  let spec = cache.get(data);
  if (!spec) {
    spec = lineMetrics ? { kind: 'geojson', data, lineMetrics: true } : { kind: 'geojson', data };
    cache.set(data, spec);
  }
  return spec;
}

export function buildActivitySources(input: ActivitySourceInput): Record<string, MapSourceSpec> {
  return {
    overlay: geojsonSource(input.overlayGeoJSON),
    // One source for the solid and the gradient line: line-gradient needs
    // line-progress, which only a lineMetrics source has, and the solid line
    // draws from it unchanged. Two would send and tile the whole track twice.
    route: geojsonSource(input.routeGeoJSON, true),
    portions: geojsonSource(input.consolidatedPortionsGeoJSON),
    'section-boundaries': geojsonSource(input.sectionBoundariesGeoJSON),
    'section-markers': geojsonSource(input.sectionMarkersGeoJSON),
    'section-creation-line': geojsonSource(input.sectionCreationLine),
    'section-creation-markers': geojsonSource(input.sectionCreationMarkers),
    endpoints: geojsonSource(input.endpointsGeoJSON),
    highlight: geojsonSource(input.highlightGeoJSON),
    [USER_LOCATION_SOURCE_ID]: geojsonSource(input.userLocationGeoJSON),
  };
}

/**
 * A section portion's colour: the record colour for a personal record, else the
 * subject line's own colour. Its number badge is what tells sections apart.
 */
function sectionPortionColour(palette: MapPalette): unknown[] {
  return ['case', ['==', ['get', 'isPR'], true], palette.record, palette.route];
}

export function buildActivityLayers(input: ActivityLayerInput): MapLayerSpec[] {
  const {
    palette,
    gradientActive,
    gradientLineExpression,
    hasSectionOverlays,
    highlightedSectionId,
    hasHighlightPoint,
    overlayHasData,
    creationMode,
    hasUserLocation,
  } = input;

  const highlighted = !!highlightedSectionId;
  const isHighlightedSection = ['==', ['get', 'id'], highlightedSectionId ?? ''];
  const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
  // While a section is highlighted the rest of the track is context: it is
  // drawn in the muted colour at full opacity, which holds its contrast on
  // every base where a fainter subject colour would not.
  const routeColour = highlighted ? palette.muted : palette.route;
  const layer = palette.layer;
  const portionColor = sectionPortionColour(palette);

  return [
    ...overlayLayers('', overlayHasData, palette),
    {
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: roundLine,
      paint: {
        'line-color': palette.casing,
        'line-width': 5,
        'line-opacity': highlighted ? 0 : 1,
      },
    },
    {
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: roundLine,
      paint: {
        'line-color': routeColour,
        'line-width': 4,
        // The solid line gives way entirely when gradient colouring is on.
        'line-opacity': gradientActive ? 0 : 1,
      },
    },
    {
      id: 'route-gradient-line',
      type: 'line',
      source: 'route',
      layout: roundLine,
      paint: {
        'line-color': palette.route,
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
        'line-color': palette.casing,
        'line-width': highlighted ? ['case', isHighlightedSection, 7, 5] : 6,
        // A portion outside the highlight is context, which carries no casing.
        'line-opacity': hasSectionOverlays
          ? highlighted
            ? ['case', isHighlightedSection, 1, 0]
            : 1
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
          ? ['case', isHighlightedSection, palette.ink, palette.muted]
          : portionColor,
        'line-width': highlighted ? ['case', isHighlightedSection, 5, 3] : 4,
        // Dashed over its casing, so a portion reads as the track with the
        // casing showing through and overlapping portions stay apart.
        'line-dasharray': [2, 1.2],
        'line-opacity': hasSectionOverlays ? 1 : 0,
      },
    },
    {
      id: 'section-boundary-casing',
      type: 'line',
      source: 'section-boundaries',
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': layer.boundaryCasing,
        'line-width': 6,
        'line-opacity': 0.45,
      },
    },
    {
      id: 'section-boundary-line',
      type: 'line',
      source: 'section-boundaries',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': palette.casing, 'line-width': 3.5 },
    },
    ...buildEndpointLayers(palette),
    {
      id: 'section-creation-line',
      type: 'line',
      source: 'section-creation-line',
      layout: roundLine,
      paint: {
        ...sectionCreationLinePaint(palette),
        'line-opacity': creationMode ? 1 : 0,
      },
    },
    {
      id: 'section-creation-marker',
      type: 'circle',
      source: 'section-creation-markers',
      paint: {
        ...sectionCreationMarkerPaint('position', palette),
        'circle-opacity': creationMode ? 1 : 0,
        'circle-stroke-opacity': creationMode ? 1 : 0,
      },
    },
    {
      id: 'section-creation-marker-icon',
      type: 'symbol',
      source: 'section-creation-markers',
      layout: {
        'icon-image': [
          'case',
          ['==', ['get', 'position'], 'start'],
          SECTION_START_ICON_ID,
          SECTION_END_ICON_ID,
        ],
        'icon-size': 0.25,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
      },
      paint: { 'icon-color': palette.casing, 'icon-opacity': creationMode ? 1 : 0 },
      visible: creationMode,
    },
    {
      id: 'section-marker-border',
      type: 'circle',
      source: 'section-markers',
      filter: ['!=', ['get', 'isPR'], true],
      paint: { 'circle-radius': 14, 'circle-color': palette.casing },
    },
    {
      id: 'section-marker-circle',
      type: 'circle',
      source: 'section-markers',
      filter: ['!=', ['get', 'isPR'], true],
      paint: {
        'circle-radius': 12,
        'circle-color': palette.route,
        'circle-stroke-width': 2,
        'circle-stroke-color': palette.casing,
      },
    },
    {
      id: 'section-marker-label',
      type: 'symbol',
      source: 'section-markers',
      filter: ['!=', ['get', 'isPR'], true],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': BUNDLED_TEXT_FONT,
        'text-size': 11,
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': palette.badgeInk },
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
      paint: { 'icon-color': palette.record },
    },
    {
      id: 'highlight-border',
      type: 'circle',
      source: 'highlight',
      paint: {
        'circle-radius': 7,
        'circle-color': palette.casing,
        'circle-opacity': hasHighlightPoint ? 1 : 0,
      },
    },
    {
      id: 'highlight-fill',
      type: 'circle',
      source: 'highlight',
      paint: {
        'circle-radius': 5,
        'circle-color': palette.ink,
        'circle-opacity': hasHighlightPoint ? 1 : 0,
      },
    },
    ...buildUserLocationLayers(hasUserLocation, palette),
  ];
}

/** The matched route, drawn under everything that sits on the track. */
function overlayLayers(
  prefix: string,
  overlayHasData: boolean,
  palette: MapPalette
): MapLayerSpec[] {
  const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
  return [
    {
      id: `${prefix}overlay-line`,
      type: 'line',
      source: 'overlay',
      layout: roundLine,
      paint: {
        'line-color': palette.muted,
        'line-width': OVERLAY_LINE_WIDTH,
        'line-opacity': overlayHasData ? 1 : 0,
      },
    },
  ];
}

/**
 * Fullscreen draws the section portions over BaseMapView's own route line and
 * marks the PR sections, without the numbered badges or the creation overlays.
 * The matched route goes beneath that line, through BaseMapView's under-route
 * layers.
 */
export function buildFullscreenSectionSources(
  portions: GeoJSON.FeatureCollection,
  prMarkers: GeoJSON.FeatureCollection,
  overlay: GeoJSON.FeatureCollection | GeoJSON.Feature = EMPTY_FEATURE_COLLECTION
): Record<string, MapSourceSpec> {
  return {
    overlay: { kind: 'geojson', data: overlay },
    portions: { kind: 'geojson', data: portions },
    'pr-markers': { kind: 'geojson', data: prMarkers },
  };
}

/** The matched route for BaseMapView's under-route layers. */
export function buildFullscreenMatchedRouteLayers(
  overlayHasData: boolean,
  palette: MapPalette
): MapLayerSpec[] {
  return overlayLayers('fullscreen-', overlayHasData, palette);
}

export function buildFullscreenSectionLayers(
  hasSectionOverlays: boolean,
  palette: MapPalette
): MapLayerSpec[] {
  return [
    {
      id: 'fullscreen-portion-casing',
      type: 'line',
      source: 'portions',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': palette.casing,
        'line-width': 6,
        'line-opacity': hasSectionOverlays ? 1 : 0,
      },
    },
    {
      id: 'fullscreen-portion-line',
      type: 'line',
      source: 'portions',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': sectionPortionColour(palette),
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
      paint: { 'icon-color': palette.record },
    },
  ];
}

export const FULLSCREEN_SECTION_MARKER_LAYER_IDS = ['fullscreen-pr-icon'];

export interface Activity3DCollectionInput {
  portions: GeoJSON.FeatureCollection;
  matchedRoute: GeoJSON.FeatureCollection | GeoJSON.Feature;
  markers: GeoJSON.FeatureCollection;
  /** Boundary ticks, which only the inline map draws. */
  boundaries?: GeoJSON.FeatureCollection | undefined;
}

export interface Activity3DCollections {
  tracesGeoJSON: GeoJSON.FeatureCollection | undefined;
  routesGeoJSON: GeoJSON.FeatureCollection;
  sectionMarkersGeoJSON: GeoJSON.FeatureCollection | undefined;
  sectionBoundariesGeoJSON: GeoJSON.FeatureCollection | undefined;
}

function unlessEmpty(
  collection: GeoJSON.FeatureCollection | undefined
): GeoJSON.FeatureCollection | undefined {
  return collection && collection.features.length > 0 ? collection : undefined;
}

/**
 * The activity's overlays as the 3D page takes them. The inline map and the
 * fullscreen one both build through here, so the portions and the matched
 * route draw the same in either; they differ in the markers they pass and in
 * the boundary ticks only the inline map draws. The page takes the matched
 * route as a collection where the flat map reads a single feature.
 */
export function buildActivity3DCollections({
  portions,
  matchedRoute,
  markers,
  boundaries,
}: Activity3DCollectionInput): Activity3DCollections {
  return {
    tracesGeoJSON: unlessEmpty(portions),
    routesGeoJSON:
      matchedRoute.type === 'Feature'
        ? { type: 'FeatureCollection', features: [matchedRoute] }
        : matchedRoute,
    sectionMarkersGeoJSON: unlessEmpty(markers),
    sectionBoundariesGeoJSON: unlessEmpty(boundaries),
  };
}
