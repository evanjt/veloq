/**
 * Subscribe to the Rust sync service status.
 *
 * Reads `SyncManager.get_sync_status()` via the engine, once at mount and then
 * only when the engine announces a step or a settle. The command + status
 * boundary means the JS thread never blocks on I/O, so this hook only ever
 * reads a cheap snapshot.
 *
 * Unless the engine cannot announce at all, in which case `eventFallback`
 * ticks the same read once a second. Nothing else would move the line: the
 * transition into a sync is itself an announcement, so a fallback that waited
 * to see a sync running would never start.
 *
 * An announcement is not guaranteed to arrive: one queued under an observer
 * that was then replaced goes to the old registration, and one pushed while the
 * registration is cleared goes nowhere. A snapshot that says a sync is running
 * is therefore re-read on a slow timer even while events are live, so a lost
 * settle leaves the line on its step for seconds and not for the process.
 *
 * The read is shared. Seven components mount this hook and Rust announces per
 * step, so a per-instance subscription made seven engine calls for every step
 * of every sync. One module-level subscription reads once and hands the same
 * snapshot to all of them.
 */
import { useSyncExternalStore } from 'react';
import { freshLoginTimeline } from '@/shared/debug/freshLoginTimeline';
import { getEngine } from './engine';
import { reconsiderFallback, subscribeToFallbackTick } from './eventFallback';
import { SyncState, type SyncStatus } from 'veloqrs';

/**
 * What the sync service announces: every step, and the terminal transition.
 * `syncReset` is not a sync at all, it is the database being replaced under
 * one, by a wipe or a restore. The counts and the error describe the database
 * that went, so the snapshot has to be re-read even though nothing synced.
 */
const CHANNELS = ['sync', 'syncProgress', 'syncSettled', 'syncReset'] as const;

/** How often a snapshot that says a sync is running is re-read regardless of events. */
export const SYNC_RUNNING_REREAD_MS = 15_000;

let snapshot: SyncStatus | null = null;
let rereadTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribes: (() => void)[] = [];
let unsubscribeFallback: (() => void) | null = null;
const listeners = new Set<() => void>();

function armReread() {
  const running = snapshot?.state === SyncState.Syncing;
  if (running && !rereadTimer) {
    rereadTimer = setInterval(read, SYNC_RUNNING_REREAD_MS);
  } else if (!running && rereadTimer) {
    clearInterval(rereadTimer);
    rereadTimer = null;
  }
}

function read() {
  const engine = getEngine();
  if (!engine) return;
  snapshot = engine.getSyncStatus();
  freshLoginTimeline.observeSync(snapshot);
  armReread();
  listeners.forEach((notify) => notify());
}

/**
 * Attach on the first subscriber, and on any later one while still detached:
 * the handle always exists but the engine is closed until launch opens it,
 * so the first component to mount is often too early and the next one has to
 * try again.
 */
function attach() {
  if (unsubscribes.length > 0) return;
  const engine = getEngine();
  if (!engine) return;
  unsubscribes = CHANNELS.map((channel) => engine.subscribe(channel, read));
  // An engine whose observer was withheld announces none of the four, so the
  // line would hold its first step for the whole sync. The timer only runs
  // while that is the case on an open engine. The handle exists before the
  // engine opens, so launch reconsiders once it has.
  reconsiderFallback();
  unsubscribeFallback = subscribeToFallbackTick(read);
  read();
}

function detach() {
  unsubscribes.forEach((off) => off());
  unsubscribes = [];
  unsubscribeFallback?.();
  unsubscribeFallback = null;
  snapshot = null;
  armReread();
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

function getState(): SyncStatus['state'] | null {
  return snapshot?.state ?? null;
}

export function useSyncState(): SyncStatus['state'] | null {
  return useSyncExternalStore(subscribe, getState, getState);
}

function getLastError(): SyncStatus['lastError'] {
  return snapshot?.lastError;
}

export function useSyncLastError(): SyncStatus['lastError'] {
  return useSyncExternalStore(subscribe, getLastError, getLastError);
}
