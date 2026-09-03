/**
 * What the map cache row adds up, and whether it could add all of it.
 *
 * Three stores feed the row and only one of them is synchronous. The tile
 * stats come back over `postMessage` from a WebView and are null until it
 * answers, which on a cold screen it may never do. Folding that null in as a
 * zero is what made `Map tiles 14.7 MB` and `3D previews 14.7 MB` the same
 * number: the sum was one store wearing the name of three.
 */

import type { TileCacheStats } from '@/features/maps/lib/terrainSnapshotEvents';

/** The stores the row folds in, in the order the label names them. */
export const MAP_CACHE_SOURCES = ['previews', 'heatmap', 'tiles'] as const;

export interface MapCacheInput {
  terrainBytes: number;
  heatmapBytes: number;
  tileStats: TileCacheStats | null;
}

export interface MapCacheTotal {
  bytes: number;
  /** False when a store has not answered, so the bytes are a floor. */
  complete: boolean;
}

export function mapCacheTotal({
  terrainBytes,
  heatmapBytes,
  tileStats,
}: MapCacheInput): MapCacheTotal {
  return {
    bytes: terrainBytes + heatmapBytes + (tileStats?.totalBytes ?? 0),
    complete: tileStats !== null,
  };
}
