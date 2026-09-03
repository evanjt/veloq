/**
 * Source and layer specs for the section detail map.
 *
 * One definition drives both the inline surface and the fullscreen shell, so
 * the two views cannot drift apart. Every source stays declared even when it is
 * empty, which keeps a toggle to a data swap rather than a layer rebuild.
 */
import { colors, mapLayerColors, mapPreviewColors } from '@/theme';
import type { MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import type { SectionMapLayers } from './useSectionMapLayers';

export const NEARBY_LINE_LAYER_ID = 'nearby-line';

interface SectionLayerInput extends SectionMapLayers {
  nearbyEndpoints: GeoJSON.FeatureCollection;
  endpoints: GeoJSON.FeatureCollection;
  activityColor: string;
  sectionOpacity: number;
  trimRange: { start: number; end: number } | null;
  hasExtension: boolean;
  /** Fullscreen drops the context overlays and draws the trim a touch heavier. */
  showExtensionAndSection: boolean;
  trimCasingWidth: number;
  trimLineWidth: number;
  traceCasingWidth: number;
  traceLineWidth: number;
  /** Neighbouring section the user tapped, drawn in the accent colour. */
  selectedNearbyId: string | null;
}

export function buildSectionSources(input: SectionLayerInput): Record<string, MapSourceSpec> {
  return {
    nearby: { kind: 'geojson', data: input.nearbyGeoJSON },
    'nearby-endpoints': { kind: 'geojson', data: input.nearbyEndpoints },
    shadow: { kind: 'geojson', data: input.shadowGeoJSON },
    extension: { kind: 'geojson', data: input.extensionGeoJSON },
    section: { kind: 'geojson', data: input.sectionGeoJSON },
    trimmed: { kind: 'geojson', data: input.trimmedGeoJSON },
    'all-traces': { kind: 'geojson', data: input.allTracesFeatureCollection },
    'highlighted-lap': { kind: 'geojson', data: input.highlightedLapGeoJSON },
    'highlighted-trace': { kind: 'geojson', data: input.highlightedTraceGeoJSON },
    endpoints: { kind: 'geojson', data: input.endpoints },
  };
}

export function buildSectionLayers(input: SectionLayerInput): MapLayerSpec[] {
  const {
    activityColor,
    sectionOpacity,
    trimRange,
    hasExtension,
    showExtensionAndSection,
    trimCasingWidth,
    trimLineWidth,
    traceCasingWidth,
    traceLineWidth,
    selectedNearbyId,
    highlightedTraceFilter,
    hasAllTraces,
  } = input;

  const selected = selectedNearbyId ?? '';
  const isSelected = ['==', ['get', 'sectionId'], selected];
  const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
  const traceVisible = hasAllTraces && !!highlightedTraceFilter;

  const layers: MapLayerSpec[] = [
    {
      id: NEARBY_LINE_LAYER_ID,
      type: 'line',
      source: 'nearby',
      layout: roundLine,
      paint: {
        'line-color': ['case', isSelected, colors.primary, colors.neutralLine],
        'line-opacity': ['case', isSelected, 0.8, 0.4],
        'line-width': ['case', isSelected, 5, 3],
        'line-dasharray': [2, 2],
      },
    },
    {
      id: 'nearby-endpoint-border',
      type: 'circle',
      source: 'nearby-endpoints',
      paint: {
        'circle-radius': 6.5,
        'circle-color': mapLayerColors.casing,
        'circle-opacity': 0.5,
      },
    },
    {
      id: 'nearby-endpoint-fill',
      type: 'circle',
      source: 'nearby-endpoints',
      paint: {
        'circle-radius': 5,
        'circle-color': [
          'case',
          ['==', ['get', 'position'], 'start'],
          mapLayerColors.nearbyStart,
          mapLayerColors.nearbyEnd,
        ],
      },
    },
    {
      id: 'shadow-line',
      type: 'line',
      source: 'shadow',
      layout: roundLine,
      paint: { 'line-color': colors.gray500, 'line-opacity': 0.5, 'line-width': 3 },
    },
  ];

  if (showExtensionAndSection) {
    layers.push(
      {
        id: 'extension-casing',
        type: 'line',
        source: 'extension',
        layout: roundLine,
        paint: {
          'line-color': mapLayerColors.boundaryCasing,
          'line-opacity': hasExtension ? 0.5 : 0,
          'line-width': 6,
        },
      },
      {
        id: 'extension-line',
        type: 'line',
        source: 'extension',
        layout: roundLine,
        paint: {
          'line-color': mapLayerColors.extension,
          'line-opacity': hasExtension ? 1 : 0,
          'line-width': 4,
        },
      },
      {
        id: 'section-casing',
        type: 'line',
        source: 'section',
        layout: roundLine,
        paint: {
          'line-color': mapLayerColors.casing,
          'line-opacity': sectionOpacity,
          'line-width': 5,
        },
      },
      {
        id: 'section-line',
        type: 'line',
        source: 'section',
        layout: roundLine,
        paint: {
          'line-color': activityColor,
          'line-opacity': sectionOpacity,
          'line-width': 4,
        },
      }
    );
  }

  layers.push(
    {
      id: 'trimmed-casing',
      type: 'line',
      source: 'trimmed',
      layout: roundLine,
      paint: {
        'line-color': mapLayerColors.casing,
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
        'line-color': activityColor,
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
        'line-color': mapPreviewColors.routeHalo,
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
        'line-color': colors.chartCyan,
        'line-width': traceLineWidth,
        'line-opacity': traceVisible ? 1 : 0,
      },
    },
    {
      id: 'highlighted-lap-casing',
      type: 'line',
      source: 'highlighted-lap',
      layout: roundLine,
      paint: { 'line-color': mapPreviewColors.routeHalo, 'line-width': traceCasingWidth },
    },
    {
      id: 'highlighted-lap-line',
      type: 'line',
      source: 'highlighted-lap',
      layout: roundLine,
      paint: { 'line-color': colors.chartCyan, 'line-width': traceLineWidth },
    },
    {
      id: 'highlighted-trace-casing',
      type: 'line',
      source: 'highlighted-trace',
      layout: roundLine,
      paint: { 'line-color': mapPreviewColors.routeHalo, 'line-width': 5 },
    },
    {
      id: 'highlighted-trace-line',
      type: 'line',
      source: 'highlighted-trace',
      layout: roundLine,
      paint: { 'line-color': colors.chartCyan, 'line-width': 4 },
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
    }
  );

  return layers;
}
