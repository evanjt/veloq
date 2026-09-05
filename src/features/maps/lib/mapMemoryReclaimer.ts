import { registerReclaimer, TRIM_MODERATE } from '@/shared/app/memoryPressure';

import { emitClearTileCache } from './terrainSnapshotEvents';

/**
 * Terrain, satellite and vector tiles are the largest regenerable store the map
 * WebViews hold. They are refetched on the next pan, so they go from
 * `TRIM_MEMORY_MODERATE`, once the process is a candidate for the killer.
 */
export function registerTileCacheReclaimer(): () => void {
  return registerReclaimer({
    name: 'map-tile-cache',
    minLevel: TRIM_MODERATE,
    release: () => emitClearTileCache(),
  });
}
