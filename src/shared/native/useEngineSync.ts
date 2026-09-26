/**
 * Drive the Rust sync service and wake the readers when it settles.
 *
 * The engine-backed hooks read SQLite, so something has to fill it and
 * something has to tell them it changed. `syncNow` is the first half. The
 * second is the transition out of `syncing`: the job finishes on a Rust
 * thread, which cannot reach the TypeScript listener map, so the terminal
 * state observed here is what fans the change out over the engine channel.
 *
 * A sync that settles with an error re-arms the latch, and a reconnect or a
 * return from the background then retries it. Without that the only cure for a
 * transient network failure was a relaunch.
 *
 * The same transition announces the settled edge, because the sync holds an
 * exclusive slot while it runs and refuses everything else that asks for one,
 * and pushes a fresh snapshot to the home-screen widget.
 *
 * The settle is not the only wake, though. Rust announces each activity step
 * as its rows land, and that is what the first launch's feed and preview fetch
 * key on: the head window is seconds in, the settle is minutes.
 *
 * Demo mode holds no credential, so it skips the sync entirely and reads the
 * rows `seedDemoEngine` wrote.
 */
import { useEffect, useRef, useState } from 'react';
import { hasStarted, SyncState } from 'veloqrs';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { emitSyncSettled, useForeground, useReconnect } from '@/shared/app/useRetryTriggers';

import { updateWidgetSnapshot } from '@/features/home/lib/widgetBridge';

import { cancelSyncRefresh } from './syncRefresh';

import { getEngine } from './engine';
import { subscribeToFallbackTick } from './eventFallback';
import { useSyncStatus } from './useSyncStatus';

export function useEngineSync(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const status = useSyncStatus();
  const state = status?.state;
  const engineReadyNonce = useEngineStatus((s) => s.readyNonce);
  const startedRef = useRef(false);
  const wasSyncingRef = useRef(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = () => setRetryNonce((nonce) => nonce + 1);

  useEffect(() => {
    if (!isAuthenticated || isDemoMode || startedRef.current) return;
    const engine = getEngine();
    if (!engine) return;
    // This hook mounts before the root layout has opened the engine, so the
    // first call reaches a null handle and refuses without touching Rust.
    // Latching on the verdict keeps the retry alive until the ready nonce
    // brings the effect back with a real engine.
    startedRef.current = hasStarted(engine.syncNow());
  }, [isAuthenticated, isDemoMode, engineReadyNonce, retryNonce]);

  // Re-arm on logout so the next session syncs again. A pull-to-refresh held
  // for the settle that never came goes with it: the next athlete did not ask
  // for it.
  useEffect(() => {
    if (!isAuthenticated) {
      startedRef.current = false;
      cancelSyncRefresh();
    }
  }, [isAuthenticated]);

  // A sync's activity steps land their rows long before the job settles: the
  // head window is seconds into a first launch and the settle is the profile
  // slice, the rest of the library, the curves and every owed interval body
  // away. Without this the feed held its standby and the preview fetch had not
  // started for all of it.
  useEffect(() => {
    const unsubscribe = getEngine()?.subscribe('activitiesStored', () => {
      getEngine()?.triggerRefresh('activities');
    });
    return () => unsubscribe?.();
  }, [engineReadyNonce]);

  // And the same refresh on the fallback timer, for an engine whose observer
  // was withheld and so announces no step at all. Only while a sync is
  // actually running: the settle below refreshes once on its own, and a
  // refresh per second over an idle library is a SQLite read per second for
  // rows nothing is writing. `useSyncStatus` polls the state itself, which is
  // what makes this condition observable at all when nothing can announce.
  useEffect(() => {
    if (state !== SyncState.Syncing) return undefined;
    return subscribeToFallbackTick(() => getEngine()?.triggerRefresh('activities'));
  }, [state, engineReadyNonce]);

  // Re-arm when the library is wiped. "Clear & Sync" empties SQLite and
  // announces `syncReset`, but the latch is still set from this same process,
  // so nothing asked Rust to refill it and the library stayed empty until the
  // next cold launch. The bump is what brings the start effect back, since
  // clearing the ref alone changes nothing the effect depends on.
  useEffect(() => {
    const unsubscribe = getEngine()?.subscribe('syncReset', () => {
      startedRef.current = false;
      // The wipe is the sync this hook is about to start, so a pull held from
      // before it has nothing left to refresh.
      cancelSyncRefresh();
      retry();
    });
    return () => unsubscribe?.();
  }, [engineReadyNonce]);

  useEffect(() => {
    if (state === SyncState.Syncing) {
      wasSyncingRef.current = true;
      return;
    }
    if (!wasSyncingRef.current) return;
    wasSyncingRef.current = false;
    // A start refused because this sync held the exclusive slot never latched,
    // and the error path below clears the latch for a different reason, so the
    // two are told apart before it runs.
    const startWasRefused = !startedRef.current;
    // An expired credential is not a network problem, so it stays latched and
    // waits for the re-auth rather than hammering a 401 on every foreground.
    if (state === SyncState.Idle && status?.lastError) startedRef.current = false;
    // Everything the sync writes hangs off this channel, so one refresh wakes
    // the profile, sport-settings and wellness readers together.
    getEngine()?.triggerRefresh('activities');
    // The exclusive slot is free again. Anything the sync refused while it held
    // it gets its one chance to ask now.
    emitSyncSettled();
    // Logging out and in as another athlete mid-sync leaves the new athlete's
    // first `syncNow` refused, and nothing else asks again until a
    // backgrounding or a network change. The slot is free now, so ask.
    if (startWasRefused) retry();
    // The widget's other writers are backgrounding and the silent-push task, so
    // without this a foreground sync leaves the home screen on yesterday's
    // numbers. A sync that failed part-way still wrote what it did fetch, so the
    // error path refreshes too.
    updateWidgetSnapshot();
  }, [state, status?.lastError]);

  useReconnect(retry);
  useForeground(retry);
}
