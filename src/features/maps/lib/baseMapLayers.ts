import { colors, mapLayerColors } from '@/theme';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';

interface BaseMapLayerInput {
  routeColor?: string | undefined;
  /** Drawn first, so the route line sits over them. */
  underRouteLayers: MapLayerSpec[];
  /** Drawn over the route line. */
  overlayLayers: MapLayerSpec[];
  /** The user's location dot, always the topmost. */
  userLocationLayers: MapLayerSpec[];
}

/**
 * The fullscreen map's layers in draw order, first at the bottom. The surface
 * inserts each layer beneath the one after it, so the order of this list is the
 * only thing that decides what covers what.
 */
export function composeBaseMapLayers({
  routeColor = colors.actionPrimary,
  underRouteLayers,
  overlayLayers,
  userLocationLayers,
}: BaseMapLayerInput): MapLayerSpec[] {
  return [
    ...underRouteLayers,
    {
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': mapLayerColors.casing, 'line-width': 5 },
    },
    {
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': routeColor, 'line-width': 4 },
    },
    ...overlayLayers,
    ...userLocationLayers,
  ];
}
