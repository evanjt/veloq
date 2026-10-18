/**
 * Source and layer specs for the section detail map.
 *
 * One definition drives both the inline surface and the fullscreen shell, so
 * the two views cannot drift apart. Every source stays declared even when it is
 * empty, which keeps a toggle to a data swap rather than a layer rebuild.
 */
import type { MapPalette } from '@/theme';
import {
  DELTA_GAPS_SOURCE_ID,
  buildDeltaGapLayer,
  lineBandExpression,
  type LineBand,
  type LineDirection,
  type MapLayerSpec,
  type MapSourceSpec,
  USER_LOCATION_SOURCE_ID,
  buildDirectionLayer,
  buildEndpointLayers,
  buildUserLocationLayers,
} from '@/features/maps';
import type { SectionMapLayers } from './useSectionMapLayers';

interface SectionLayerInput extends SectionMapLayers {
  endpoints: GeoJSON.FeatureCollection;
  /** An attempt, a lap or a trim is shown, so the section itself is context. */
  sectionContext: boolean;
  trimRange: { start: number; end: number } | null;
  hasExtension: boolean;
  /** Fullscreen drops the context overlays and draws the trim a touch heavier. */
  showExtensionAndSection: boolean;
  trimCasingWidth: number;
  trimLineWidth: number;
  traceCasingWidth: number;
  traceLineWidth: number;
  /**
   * The bands of the section line by how far ahead or behind the shown attempt
   * is, while the chart shows the delta plot. Without them the line is the
   * base's route colour.
   */
  deltaBands?: readonly LineBand[] | null;
  /** The stretches of the section line the shown attempt has no data for, cut as geometry. */
  deltaGapsGeoJSON: GeoJSON.FeatureCollection;
  /**
   * The direction the performance panel is on, drawn as chevrons along the
   * section line. Null where the section is ridden one way only.
   */
  shownDirection?: LineDirection | null;
  /**
   * The athlete's position, drawn as a dot above the section. Left out where a
   * shell draws its own dot, so the same source id is never declared twice.
   */
  userLocationGeoJSON?: GeoJSON.FeatureCollection;
  hasUserLocation?: boolean;
}

/**
 * The direction the section line's chevrons show, which the map key names. A
 * trim is about the bounds rather than a way of riding them, so it shows none.
 */
export function drawnSectionDirection(
  shownDirection: LineDirection | null | undefined,
  trimRange: { start: number; end: number } | null
): LineDirection | null {
  return trimRange ? null : (shownDirection ?? null);
}

export function buildSectionSources(input: SectionLayerInput): Record<string, MapSourceSpec> {
  return {
    shadow: { kind: 'geojson', data: input.shadowGeoJSON },
    extension: { kind: 'geojson', data: input.extensionGeoJSON },
    // line-gradient addresses the line by line-progress, which needs line metrics;
    // the source stays the same in every mode and only the paint changes.
    section: { kind: 'geojson', data: input.sectionGeoJSON, lineMetrics: true },
    trimmed: { kind: 'geojson', data: input.trimmedGeoJSON },
    'all-traces': { kind: 'geojson', data: input.allTracesFeatureCollection },
    'highlighted-lap': { kind: 'geojson', data: input.highlightedLapGeoJSON },
    'highlighted-trace': { kind: 'geojson', data: input.highlightedTraceGeoJSON },
    endpoints: { kind: 'geojson', data: input.endpoints },
    [DELTA_GAPS_SOURCE_ID]: { kind: 'geojson', data: input.deltaGapsGeoJSON },
    ...(input.userLocationGeoJSON
      ? { [USER_LOCATION_SOURCE_ID]: { kind: 'geojson' as const, data: input.userLocationGeoJSON } }
      : {}),
  };
}

export function buildSectionLayers(
  input: SectionLayerInput & {
    /** The colours of the base map drawn under the layers. */
    palette: MapPalette;
  }
): MapLayerSpec[] {
  const {
    palette,
    sectionContext,
    trimRange,
    hasExtension,
    showExtensionAndSection,
    trimCasingWidth,
    trimLineWidth,
    traceCasingWidth,
    traceLineWidth,
    deltaBands,
    shownDirection,
    highlightedTraceFilter,
    hasAllTraces,
  } = input;

  const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
  const traceVisible = hasAllTraces && !!highlightedTraceFilter;

  const layers: MapLayerSpec[] = [
    {
      id: 'shadow-line',
      type: 'line',
      source: 'shadow',
      layout: roundLine,
      paint: { 'line-color': palette.muted, 'line-width': 2 },
    },
  ];

  if (showExtensionAndSection) {
    layers.push(
      {
        id: 'extension-line',
        type: 'line',
        source: 'extension',
        layout: roundLine,
        paint: {
          'line-color': palette.muted,
          'line-opacity': hasExtension ? 1 : 0,
          'line-width': 2,
        },
      },
      {
        id: 'section-casing',
        type: 'line',
        source: 'section',
        layout: roundLine,
        paint: {
          'line-color': palette.casing,
          // Context lines carry no casing.
          'line-opacity': sectionContext ? 0 : 1,
          'line-width': 5,
        },
      },
      {
        id: 'section-line',
        type: 'line',
        source: 'section',
        layout: roundLine,
        paint: {
          ...(deltaBands
            ? { 'line-gradient': lineBandExpression(deltaBands, palette) }
            : { 'line-color': sectionContext ? palette.muted : palette.route }),
          'line-width': sectionContext ? 2 : 4,
        },
      }
    );
  }

  // Fullscreen draws the section as the base map's route line, at its width.
  layers.push(buildDeltaGapLayer(palette, showExtensionAndSection && sectionContext ? 2 : 4));

  // Over the section line, whichever map draws it: the base map draws it in
  // fullscreen, from the same source.
  layers.push(
    buildDirectionLayer({
      id: 'section-direction',
      source: 'section',
      palette,
      direction: drawnSectionDirection(shownDirection, trimRange),
    })
  );

  layers.push(
    {
      id: 'trimmed-casing',
      type: 'line',
      source: 'trimmed',
      layout: roundLine,
      paint: {
        'line-color': palette.casing,
        'line-opacity': trimRange ? 1 : 0,
        'line-width': trimCasingWidth,
      },
    },
    {
      id: 'trimmed-line',
      type: 'line',
      source: 'trimmed',
      layout: roundLine,
      paint: {
        'line-color': palette.route,
        'line-opacity': trimRange ? 1 : 0,
        'line-width': trimLineWidth,
      },
    },
    {
      id: 'all-traces-casing',
      type: 'line',
      source: 'all-traces',
      filter: highlightedTraceFilter as unknown[] | undefined,
      layout: roundLine,
      paint: {
        'line-color': palette.casing,
        'line-width': traceCasingWidth,
        'line-opacity': traceVisible ? 1 : 0,
      },
    },
    {
      id: 'all-traces-line',
      type: 'line',
      source: 'all-traces',
      filter: highlightedTraceFilter as unknown[] | undefined,
      layout: roundLine,
      paint: {
        'line-color': palette.ink,
        'line-width': traceLineWidth,
        'line-opacity': traceVisible ? 1 : 0,
      },
    },
    {
      id: 'highlighted-lap-casing',
      type: 'line',
      source: 'highlighted-lap',
      layout: roundLine,
      paint: { 'line-color': palette.casing, 'line-width': traceCasingWidth },
    },
    {
      id: 'highlighted-lap-line',
      type: 'line',
      source: 'highlighted-lap',
      layout: roundLine,
      paint: { 'line-color': palette.ink, 'line-width': traceLineWidth },
    },
    {
      id: 'highlighted-trace-casing',
      type: 'line',
      source: 'highlighted-trace',
      layout: roundLine,
      paint: { 'line-color': palette.casing, 'line-width': 5 },
    },
    {
      id: 'highlighted-trace-line',
      type: 'line',
      source: 'highlighted-trace',
      layout: roundLine,
      paint: { 'line-color': palette.ink, 'line-width': 4 },
    },
    ...buildEndpointLayers(palette)
  );

  if (input.userLocationGeoJSON)
    layers.push(...buildUserLocationLayers(!!input.hasUserLocation, palette));

  return layers;
}
