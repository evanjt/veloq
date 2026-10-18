import type { MapPalette } from '@/theme';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';

export const HOME_RADIUS_SOURCE = 'home-radius';
export const HOME_POINT_SOURCE = 'home-point';

/** The radius trimmed around the export privacy home, and the home itself. */
export function homeRadiusLayers(palette: MapPalette): MapLayerSpec[] {
  const { layer } = palette;
  return [
    {
      id: 'home-radius-fill',
      type: 'fill',
      source: HOME_RADIUS_SOURCE,
      paint: { 'fill-color': layer.homeRadiusFill },
    },
    {
      id: 'home-radius-line',
      type: 'line',
      source: HOME_RADIUS_SOURCE,
      paint: { 'line-color': layer.homeRadius, 'line-width': 2 },
    },
    {
      id: 'home-point',
      type: 'circle',
      source: HOME_POINT_SOURCE,
      paint: {
        'circle-radius': 7,
        'circle-color': layer.homeRadius,
        'circle-stroke-color': layer.casing,
        'circle-stroke-width': 2,
      },
    },
  ];
}
