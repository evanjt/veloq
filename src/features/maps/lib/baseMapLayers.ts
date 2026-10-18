import type { MapPalette } from '@/theme';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';

/** Layers a surface hands the fullscreen map, built for the base that map draws. */
export type MapLayersForBase = (palette: MapPalette) => MapLayerSpec[];

interface BaseMapLayerInput {
  /** The colours of the base map drawn under the layers. */
  palette: MapPalette;
  /** The route line's colour, the palette's route colour when left out. */
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
  palette,
  routeColor = palette.layer.route,
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
      paint: { 'line-color': palette.layer.casing, 'line-width': 5 },
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
