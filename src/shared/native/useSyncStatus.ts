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
 *
 * The snapshot also carries the track work: the GPS download, section
 * detection and the heatmap pass, whichever is running. Rust announces when
 * each starts, and while one runs the snapshot is re-read on a short timer,
 * since a stage moves per item and announcing every item would wake every
 * reader of the sync for each one. The timer stops with the stage.
 */
import { useSyncExternalStore } from 'react';
import { freshLoginTimeline } from '@/shared/debug/freshLoginTimeline';
import { getEngine } from './engine';
import { reconsiderFallback, subscribeToFallbackTick } from './eventFallback';
import { SyncState, type SyncErrorReason, type SyncStatus, type TrackStage } from 'veloqrs';

/**
 * What the sync service announces: every step, and the terminal transition.
 * `syncReset` is not a sync at all, it is the database being replaced under
 * one, by a wipe or a restore. The counts and the error describe the database
 * that went, so the snapshot has to be re-read even though nothing synced.
 */
const CHANNELS = ['sync', 'syncProgress', 'syncSettled', 'syncReset'] as const;

/** How often a snapshot that says a sync is running is re-read regardless of events. */
export const SYNC_RUNNING_REREAD_MS = 15_000;

/** How often a snapshot that carries a track stage is re-read for its progress. */
export const TRACK_STAGE_REREAD_MS = 500;

let snapshot: SyncStatus | null = null;
let rereadTimer: ReturnType<typeof setInterval> | null = null;
let rereadEvery: number | null = null;
let unsubscribes: (() => void)[] = [];
let unsubscribeFallback: (() => void) | null = null;
const listeners = new Set<() => void>();

function rereadInterval(): number | null {
  if (snapshot?.tracks) return TRACK_STAGE_REREAD_MS;
  if (snapshot?.state === SyncState.Syncing) return SYNC_RUNNING_REREAD_MS;
  return null;
}

function armReread() {
  const every = rereadInterval();
  if (every === rereadEvery) return;
  if (rereadTimer) clearInterval(rereadTimer);
  rereadTimer = every === null ? null : setInterval(read, every);
  rereadEvery = every;
}

function sameStage(a: TrackStage | undefined, b: TrackStage | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.step === b.step &&
    a.completed === b.completed &&
    a.total === b.total &&
    a.percent === b.percent
  );
}

/** Whether two snapshots say the same thing, so a timed read that found nothing new wakes nobody. */
function sameStatus(a: SyncStatus | null, b: SyncStatus | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.state === b.state &&
    a.inFlight === b.inFlight &&
    a.completed === b.completed &&
    a.total === b.total &&
    a.stepItemsDone === b.stepItemsDone &&
    a.stepItemsTotal === b.stepItemsTotal &&
    a.step === b.step &&
    a.lastError === b.lastError &&
    a.lastErrorReason === b.lastErrorReason &&
    a.lastSuccessAt === b.lastSuccessAt &&
    a.retryAtMs === b.retryAtMs &&
    sameStage(a.tracks, b.tracks)
  );
}

function read() {
  const engine = getEngine();
  if (!engine) return;
  const next = engine.getSyncStatus();
  freshLoginTimeline.observeSync(next);
  if (sameStatus(snapshot, next)) {
    armReread();
    return;
  }
  snapshot = next;
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

function getTracks(): TrackStage | null {
  return snapshot?.tracks ?? null;
}

/**
 * The track work running now, or null: the GPS download, section detection or
 * the heatmap pass, which the engine picks. Independent of the sync's own
 * state, so a pass the engine started by itself after a settled sync is here
 * all the same.
 */
export function useTrackStage(): TrackStage | null {
  return useSyncExternalStore(subscribe, getTracks, getTracks);
}

function getLastSuccessAt(): string | null {
  return snapshot?.lastSuccessAt ?? null;
}

/** When a sync last finished clean, or null before any did. */
export function useLastSyncSuccessAt(): string | null {
  return useSyncExternalStore(subscribe, getLastSuccessAt, getLastSuccessAt);
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

function getLastErrorReason(): SyncErrorReason | null {
  return snapshot?.lastErrorReason ?? null;
}

/**
 * Why the last sync failed, or null. Its own selector so a screen that only
 * branches on the reason does not render again for every progress step.
 */
export function useSyncLastErrorReason(): SyncErrorReason | null {
  return useSyncExternalStore(subscribe, getLastErrorReason, getLastErrorReason);
}
