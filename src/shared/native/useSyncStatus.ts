/**
 * Subscribe to the Rust sync service status.
 *
 * Reads `SyncManager.get_sync_status()` via the engine, once at mount and then
 * only when the engine announces a step or a settle. The command + status
 * boundary means the JS thread never blocks on I/O, so this hook only ever
 * reads a cheap snapshot.
 *
 * The read is shared. Seven components mount this hook and Rust announces per
 * step, so a per-instance subscription made seven engine calls for every step
 * of every sync. One module-level subscription reads once and hands the same
 * snapshot to all of them.
 */
import { useSyncExternalStore } from 'react';
import { getEngine } from './engine';
import type { SyncStatus } from 'veloqrs';

/**
 * What the sync service announces: every step, and the terminal transition.
 * `syncReset` is not a sync at all, it is the database being replaced under
 * one, by a wipe or a restore. The counts and the error describe the database
 * that went, so the snapshot has to be re-read even though nothing synced.
 */
const CHANNELS = ['sync', 'syncProgress', 'syncSettled', 'syncReset'] as const;

let snapshot: SyncStatus | null = null;
let unsubscribes: (() => void)[] = [];
const listeners = new Set<() => void>();

function read() {
  const engine = getEngine();
  if (!engine) return;
  snapshot = engine.getSyncStatus();
  listeners.forEach((notify) => notify());
}

/**
 * Attach on the first subscriber, and on any later one while still detached:
 * the engine is null until launch opens it, so the first component to mount
 * is often too early and the next one has to try again.
 */
function attach() {
  if (unsubscribes.length > 0) return;
  const engine = getEngine();
  if (!engine) return;
  unsubscribes = CHANNELS.map((channel) => engine.subscribe(channel, read));
  read();
}

function detach() {
  unsubscribes.forEach((off) => off());
  unsubscribes = [];
  snapshot = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detach();
  };
}

function getSnapshot(): SyncStatus | null {
  return snapshot;
}

export function useSyncStatus(): SyncStatus | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
