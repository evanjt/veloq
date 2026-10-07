import type { PersistentEngineStats } from 'veloqrs';

/**
 * How many activities the library holds, with or without GPS.
 *
 * `getActivityCount()` is the GPS-backed set the spatial index is built from,
 * and it is smaller whenever an activity has metrics and no track. A reader
 * asking whether the library is empty, or how much of it there is to lose,
 * reads the stats' `libraryCount` instead.
 */
export function readLibraryCount(engine: {
  getStats(): Pick<PersistentEngineStats, 'libraryCount'> | undefined;
}): number {
  return engine.getStats()?.libraryCount ?? 0;
}
