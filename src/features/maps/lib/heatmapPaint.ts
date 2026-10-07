import type { MapStyleType } from '@/features/maps/components/mapStyles';

/**
 * The raster paint of the heatmap layer, for every surface that draws it.
 *
 * The tile ramp rises in lightness with density, which on a light basemap would
 * draw the densest ground palest. The light map rotates the hue by 180 degrees
 * and maps lightness onto a brightness range that falls from .3 to 0, so the
 * ramp darkens with density and keeps its teal hue. The faintest stops composite
 * at 3:1 or better against every light ground, and the faintest to the densest
 * at 3:1 or better over land. The 2D map and both 3D scripts read this one
 * function, so a retune lands on all three.
 */
export function heatmapRasterPaint(mapStyle: MapStyleType): Record<string, number | string> {
  const isLight = mapStyle === 'light';
  return {
    'raster-opacity': isLight ? 1 : 0.72,
    'raster-contrast': 0,
    ...(isLight && {
      'raster-hue-rotate': 180,
      'raster-brightness-min': 0.3,
    }),
    'raster-brightness-max': isLight ? 0 : 1,
    'raster-saturation': 0,
    'raster-resampling': 'linear',
    'raster-fade-duration': 0,
  };
}
