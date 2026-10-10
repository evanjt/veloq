import { releaseEngineMemory } from '@/shared/native/engineMemory';
import { queryClient } from '@/shared/query/QueryProvider';

import {
  clearNativeImageCache,
  registerReclaimer,
  TRIM_BACKGROUND,
  TRIM_COMPLETE,
  TRIM_MODERATE,
  TRIM_UI_HIDDEN,
} from './memoryPressure';

/**
 * Every query key is rebuilt from SQLite, so the cache is the cheapest thing to give
 * back. Below `TRIM_MEMORY_COMPLETE` only the unobserved keys go, which leaves the
 * mounted screens intact; at the last warning the whole cache goes.
 */
export function registerQueryCacheReclaimer(): () => void {
  return registerReclaimer({
    name: 'query-cache',
    minLevel: TRIM_UI_HIDDEN,
    release: (level) => {
      if (level >= TRIM_COMPLETE) {
        queryClient.clear();
      } else {
        queryClient.removeQueries({ type: 'inactive' });
      }
    },
  });
}

/**
 * Every decoded image is re-decoded from disk on the next draw, so the bitmap
 * cache goes once the process is a kill candidate.
 */
export function registerImageCacheReclaimer(): () => void {
  return registerReclaimer({
    name: 'image-cache',
    minLevel: TRIM_MODERATE,
    release: () => clearNativeImageCache(),
  });
}

/**
 * The engine's parked SQLite readers and page caches reopen and refill on the
 * next read, so they go once the process is in the background. Its LRUs and the
 * satellite rasters cost a recompute or a refetch, so they go only at the last
 * warning.
 */
export function registerEngineReclaimer(): () => void {
  return registerReclaimer({
    name: 'engine',
    minLevel: TRIM_BACKGROUND,
    release: (level) => void releaseEngineMemory(level >= TRIM_COMPLETE),
  });
}
