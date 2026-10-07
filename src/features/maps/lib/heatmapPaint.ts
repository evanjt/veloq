import type { MapStyleType } from '@/features/maps/components/mapStyles';

/**
 * The raster paint of the heatmap layer, for every surface that draws it.
 *
 * The light map takes its own opacity and brightness ceiling so the faint
 * stops of the tile ramp composite at 3:1 against the light land. The 2D map
 * and both 3D scripts read this one function, so a retune lands on all three.
 */
export function heatmapRasterPaint(mapStyle: MapStyleType): Record<string, number | string> {
  const isLight = mapStyle === 'light';
  return {
    'raster-opacity': isLight ? 1 : 0.72,
    'raster-contrast': 0,
    'raster-brightness-max': isLight ? 0.45 : 1,
    'raster-saturation': 0,
    'raster-resampling': 'linear',
    'raster-fade-duration': 0,
  };
}
