import type { MapStyleType } from '@/features/maps/components/mapStyles';
import { mapPalette } from '@/theme';

/**
 * The raster paint of the heatmap layer, for every surface that draws it.
 *
 * The engine serves each base map its tiles in that base's own opaque heat
 * steps, so the paint draws the tile's colours as they are on every base. The
 * 2D map and both 3D scripts read this one function, so a retune lands on all
 * three.
 */
export function heatmapRasterPaint(): Record<string, number | string> {
  return {
    'raster-opacity': 1,
    'raster-resampling': 'linear',
    'raster-fade-duration': 0,
  };
}

/**
 * The five heat steps the heatmap is keyed in, fewest passes first: the steps
 * the engine paints the tiles of `mapStyle` in, since both are generated from
 * that base's heat tokens.
 */
export function heatmapKeyColours(mapStyle: MapStyleType): readonly string[] {
  return mapPalette(mapStyle).heat;
}
