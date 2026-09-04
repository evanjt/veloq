/**
 * Source and layer specs for the preview overlay map.
 *
 * Every source stays declared with an empty FeatureCollection when it has
 * nothing to draw, so toggling a catalogue is a data swap, never a layer
 * rebuild, and the layer count stays fixed.
 */

import { colors, brand, mapLayerColors } from '@/theme';
import type { MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import { EMPTY_FEATURE_COLLECTION } from '@/features/maps/lib/coordinates';

export const PREVIEW_INTERACTIVE_LAYERS = ['proposed-line', 'gone-line', 'current-line'];

export interface PreviewLayerInput {
  current: GeoJSON.FeatureCollection;
  proposed: GeoJSON.FeatureCollection;
  gone: GeoJSON.FeatureCollection;
  selected: GeoJSON.FeatureCollection;
}

export function buildPreviewSources(input: PreviewLayerInput): Record<string, MapSourceSpec> {
  return {
    'current-sections': { kind: 'geojson', data: input.current },
    'proposed-sections': { kind: 'geojson', data: input.proposed },
    'gone-sections': { kind: 'geojson', data: input.gone },
    'selected-section': { kind: 'geojson', data: input.selected },
  };
}

export function buildPreviewLayers(): MapLayerSpec[] {
  const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
  return [
    {
      id: 'current-line',
      type: 'line',
      source: 'current-sections',
      layout: roundLine,
      paint: {
        'line-color': colors.neutralLine,
        'line-opacity': 0.4,
        'line-width': 3,
        'line-dasharray': [2, 2],
      },
    },
    {
      id: 'gone-line',
      type: 'line',
      source: 'gone-sections',
      layout: roundLine,
      paint: {
        'line-color': colors.error,
        'line-opacity': 0.6,
        'line-width': 3,
        'line-dasharray': [2, 2],
      },
    },
    {
      id: 'selected-casing',
      type: 'line',
      source: 'selected-section',
      layout: roundLine,
      paint: {
        'line-color': mapLayerColors.casing,
        'line-opacity': 1,
        'line-width': 7,
      },
    },
    {
      id: 'proposed-line',
      type: 'line',
      source: 'proposed-sections',
      layout: roundLine,
      paint: {
        // 'changed' and 'unchanged' both render teal; the popover status chip
        // carries the distinction.
        'line-color': ['match', ['get', 'status'], 'new', colors.success, brand.tealLight],
        'line-opacity': 0.9,
        'line-width': 4,
      },
    },
  ];
}

export { EMPTY_FEATURE_COLLECTION };
