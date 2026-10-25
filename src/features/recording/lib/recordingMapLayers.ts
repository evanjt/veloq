import type { MapPalette } from '@/theme';
import type { MapLayerSpec } from '@/features/maps';
import { NEARBY_ROUTE_HIT_LAYER } from './nearbyRouteLines';

/**
 * The map's layers, bottom to top. The live track draws in the record role, the same as every
 * other recording surface, for the app theme in `isDark`.
 */
export function recordingMapLayers(palette: MapPalette, isDark: boolean): MapLayerSpec[] {
  const { layer } = palette;
  const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
  return [
    {
      id: 'nearby-routes-line',
      type: 'line',
      source: 'nearby-routes',
      layout: roundLine,
      paint: { 'line-color': layer.recordingNearby, 'line-width': 3 },
    },
    // A finger lands wider than a faint line, so the tap is taken by a transparent line.
    {
      id: NEARBY_ROUTE_HIT_LAYER,
      type: 'line',
      source: 'nearby-routes',
      layout: roundLine,
      paint: { 'line-color': layer.recordingNearby, 'line-opacity': 0, 'line-width': 24 },
    },
    {
      id: 'route-overlay-line',
      type: 'line',
      source: 'route-overlay',
      layout: roundLine,
      paint: {
        'line-color': layer.recordingOverlay,
        'line-opacity': 0.75,
        'line-width': 5,
      },
    },
    {
      id: 'excluded-route-line',
      type: 'line',
      source: 'excluded-route',
      layout: roundLine,
      paint: { 'line-color': layer.recordingExcluded, 'line-width': 4 },
    },
    {
      id: 'recording-route-casing',
      type: 'line',
      source: 'recording-route',
      layout: roundLine,
      paint: { 'line-color': layer.positionHalo, 'line-width': 5 },
    },
    {
      id: 'recording-route-line',
      type: 'line',
      source: 'recording-route',
      layout: roundLine,
      paint: { 'line-color': layer.recording[isDark ? 'dark' : 'light'], 'line-width': 4 },
    },
    {
      id: 'current-accuracy-fill',
      type: 'fill',
      source: 'current-accuracy',
      paint: { 'fill-color': layer.position, 'fill-opacity': 0.15 },
    },
    {
      id: 'current-accuracy-outline',
      type: 'line',
      source: 'current-accuracy',
      paint: {
        'line-color': layer.position,
        'line-opacity': 0.5,
        'line-width': 1,
      },
    },
    {
      id: 'current-position-halo',
      type: 'circle',
      source: 'current-position',
      paint: {
        'circle-radius': 10,
        'circle-color': layer.positionHalo,
        'circle-opacity': 0.9,
      },
    },
    {
      id: 'current-position-dot',
      type: 'circle',
      source: 'current-position',
      paint: { 'circle-radius': 7, 'circle-color': layer.position },
    },
  ];
}
