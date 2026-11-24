/**
 * What the map cache row adds up, and whether it could add all of it.
 *
 * Three stores feed the row and none of them answers at once. The tile figure
 * comes from the Rust store and is null until that read resolves, or when the
 * store could not say. Folding that null in as a zero is what made `Map tiles
 * 14.7 MB` and `3D previews 14.7 MB` the same number: the sum was one store
 * wearing the name of three.
 */

import { type BasemapTileSizes } from '@/features/maps';

interface MapCacheInput {
  terrainBytes: number;
  /** Null when the heatmap walk failed to say. */
  heatmapBytes: number | null;
  tiles: Pick<BasemapTileSizes, 'totalBytes'> | null;
}

interface MapCacheTotal {
  bytes: number;
  /** False when a store has not answered, so the bytes are a floor. */
  complete: boolean;
}

export function mapCacheTotal({ terrainBytes, heatmapBytes, tiles }: MapCacheInput): MapCacheTotal {
  return {
    bytes: terrainBytes + (heatmapBytes ?? 0) + (tiles?.totalBytes ?? 0),
    complete: tiles !== null && heatmapBytes !== null,
  };
}
