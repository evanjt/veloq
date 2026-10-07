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
  const existing = listeners.get(activityId);
  const set = existing ?? new Set<Listener>();
  if (!existing) listeners.set(activityId, set);
  set.add(cb);

  return () => {
    set.delete(cb);
    if (set.size === 0) {
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
  const existing = failureListeners.get(activityId);
  const set = existing ?? new Set<FailureListener>();
  if (!existing) failureListeners.set(activityId, set);
  set.add(cb);

  return () => {
    set.delete(cb);
    if (set.size === 0) {
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
