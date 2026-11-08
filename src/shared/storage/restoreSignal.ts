/**
 * The signal a restore sends once the stored settings are back.
 *
 * A component that keeps a persisted choice in its own state, not in a store,
 * has no `initialise*` call to reload it; it subscribes here and reads the key
 * again when the signal arrives.
 */
const listeners = new Set<() => void>();

/** Calls `listener` after every restore; returns the function that stops it. */
export function subscribeToRestore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells every subscriber that the stored settings were replaced. */
export function signalRestoreCompleted(): void {
  for (const listener of [...listeners]) listener();
}
