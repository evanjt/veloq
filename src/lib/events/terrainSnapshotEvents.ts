/**
 * Module-level event emitter for terrain snapshot completions.
 *
 * Each ActivityMapPreview subscribes to its own activity ID. When a snapshot
 * completes, only the one card whose image is ready re-renders — instead of
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
 * Tile cache clear event — broadcast to all WebView workers to clear
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
