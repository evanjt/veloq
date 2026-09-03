/**
 * Module-level event emitter for terrain snapshot completions.
 *
 * Each ActivityMapPreview subscribes to its own activity ID. When a snapshot
 * completes, only the one card whose image is ready re-renders - instead of
 * the entire FlatList via a version counter.
 */

type Listener = (uri: string) => void;
const listeners = new Map<string, Set<Listener>>();

/**
 * Subscribe to snapshot completion for a specific activity.
 * Returns an unsubscribe function.
 */
export function subscribeSnapshot(activityId: string, cb: Listener): () => void {
  let set = listeners.get(activityId);
  if (!set) {
    set = new Set();
    listeners.set(activityId, set);
  }
  set.add(cb);

  return () => {
    set!.delete(cb);
    if (set!.size === 0) {
      listeners.delete(activityId);
    }
  };
}

/**
 * Emit a snapshot completion event for a specific activity.
 * All subscribers for that activity ID are notified.
 */
export function emitSnapshotComplete(activityId: string, uri: string): void {
  const set = listeners.get(activityId);
  if (set) {
    for (const cb of set) {
      cb(uri);
    }
  }
}

/**
 * Snapshot failure events - emitted when a request exhausts its retries so the
 * card can drop from its loading state to the route-line fallback instead of
 * spinning forever. A later successful render (pull-to-refresh retry) flips
 * the card back via the completion event.
 */
type FailureListener = () => void;
const failureListeners = new Map<string, Set<FailureListener>>();

export function subscribeSnapshotFailure(activityId: string, cb: FailureListener): () => void {
  let set = failureListeners.get(activityId);
  if (!set) {
    set = new Set();
    failureListeners.set(activityId, set);
  }
  set.add(cb);

  return () => {
    set!.delete(cb);
    if (set!.size === 0) {
      failureListeners.delete(activityId);
    }
  };
}

export function emitSnapshotFailed(activityId: string): void {
  const set = failureListeners.get(activityId);
  if (set) {
    for (const cb of set) {
      cb();
    }
  }
}

/**
 * Tile cache clear event - broadcast to all WebView workers to clear
 * the Cache API terrain DEM tile cache.
 */
type TileCacheClearListener = () => void;
const tileCacheClearListeners = new Set<TileCacheClearListener>();

export function onClearTileCache(cb: TileCacheClearListener): () => void {
  tileCacheClearListeners.add(cb);
  return () => {
    tileCacheClearListeners.delete(cb);
  };
}

export function emitClearTileCache(): void {
  for (const cb of tileCacheClearListeners) cb();
}

/**
 * Tile cache budget changes. A lowered ceiling has to reach the pages that are
 * already open, or the athlete watches the size they just shrank stay where it
 * was until the next fiftieth tile.
 */
type TileCacheBudgetListener = (budgetMb: number) => void;
const tileCacheBudgetListeners = new Set<TileCacheBudgetListener>();

export function onTileCacheBudget(cb: TileCacheBudgetListener): () => void {
  tileCacheBudgetListeners.add(cb);
  return () => {
    tileCacheBudgetListeners.delete(cb);
  };
}

export function emitTileCacheBudget(budgetMb: number): void {
  for (const cb of tileCacheBudgetListeners) cb(budgetMb);
}

/**
 * Tile cache stats - request/response pair for querying DEM tile count and size.
 * MapsSection requests stats, TerrainSnapshotWebView responds.
 */
export interface TileCacheStats {
  tileCount: number;
  totalBytes: number;
  terrain?: { tileCount: number; totalBytes: number };
  satellite?: { tileCount: number; totalBytes: number };
  vector?: { tileCount: number; totalBytes: number };
}

type TileCacheStatsRequestListener = () => void;
const tileCacheStatsRequestListeners = new Set<TileCacheStatsRequestListener>();

export function onTileCacheStatsRequest(cb: TileCacheStatsRequestListener): () => void {
  tileCacheStatsRequestListeners.add(cb);
  return () => {
    tileCacheStatsRequestListeners.delete(cb);
  };
}

export function requestTileCacheStats(): void {
  for (const cb of tileCacheStatsRequestListeners) cb();
}

type TileCacheStatsListener = (stats: TileCacheStats) => void;
const tileCacheStatsListeners = new Set<TileCacheStatsListener>();

export function onTileCacheStats(cb: TileCacheStatsListener): () => void {
  tileCacheStatsListeners.add(cb);
  return () => {
    tileCacheStatsListeners.delete(cb);
  };
}

export function emitTileCacheStats(stats: TileCacheStats): void {
  for (const cb of tileCacheStatsListeners) cb(stats);
}
