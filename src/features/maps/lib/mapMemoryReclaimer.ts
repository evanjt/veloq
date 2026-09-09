import { AppState } from 'react-native';

import { registerReclaimer, TRIM_MODERATE } from '@/shared/app/memoryPressure';

import { releaseMountedSurfaces, rebuildReleasedSurfaces } from './mapSurfaceRegistry';
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

/**
 * The MapLibre instances themselves, with every texture in them. A map the
 * athlete is looking at is never torn down, which is what iOS's foreground
 * warning would otherwise do. The rebuild is a page reload on the next
 * foreground, the same path a crashed render process takes.
 */
export function registerMapSurfaceReclaimer(): () => void {
  const off = registerReclaimer({
    name: 'map-surfaces',
    minLevel: TRIM_MODERATE,
    release: () => {
      if (AppState.currentState === 'active') return;
      releaseMountedSurfaces();
    },
  });
  const foreground = AppState.addEventListener('change', (state) => {
    if (state === 'active') rebuildReleasedSurfaces();
  });
  return () => {
    off();
    foreground.remove();
  };
}
