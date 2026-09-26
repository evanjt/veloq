import { useEffect } from 'react';

import { onClearTileCache } from '@/features/maps/lib/terrainSnapshotEvents';
import { clearTileCachesScript } from '@/features/maps/lib/tileCacheBudget';

/**
 * Drop a live page's tile buckets when the athlete clears the cache.
 *
 * The snapshot pool subscribes to this too, but it is torn down whenever the
 * feed is not focused, which is exactly when the settings screen is up. So
 * before this the clear reached nothing, and the stats the settings screen then
 * read back off the still-live map counted the tiles it was holding.
 *
 * `inject` must be stable, or the subscription is rebuilt on every render.
 */
export function useLiveTileCacheClear(inject: (script: string) => void): void {
  useEffect(() => {
    return onClearTileCache(() => inject(clearTileCachesScript()));
  }, [inject]);
}
