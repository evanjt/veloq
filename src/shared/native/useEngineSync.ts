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
 * Demo mode holds no credential, so it skips the sync entirely and reads the
 * rows `seedDemoEngine` wrote.
 */
import { useEffect, useRef, useState } from 'react';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { emitSyncSettled, useForeground, useReconnect } from '@/shared/app/useRetryTriggers';

import { updateWidgetSnapshot } from '@/features/home/lib/widgetBridge';

import { getRouteEngine } from './routeEngine';
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

  useEffect(() => {
    if (!isAuthenticated || isDemoMode || startedRef.current) return;
    const engine = getRouteEngine();
    if (!engine) return;
    // This hook mounts before the root layout has opened the engine, so the
    // first call reaches a null handle and returns false without touching
    // Rust. Latching on the return value keeps the retry alive until the
    // ready nonce brings the effect back with a real engine.
    startedRef.current = engine.syncNow();
  }, [isAuthenticated, isDemoMode, engineReadyNonce, retryNonce]);

  // Re-arm on logout so the next session syncs again.
  useEffect(() => {
    if (!isAuthenticated) startedRef.current = false;
  }, [isAuthenticated]);

  useEffect(() => {
    if (state === 'syncing') {
      wasSyncingRef.current = true;
      return;
    }
    if (!wasSyncingRef.current) return;
    wasSyncingRef.current = false;
    // An expired credential is not a network problem, so it stays latched and
    // waits for the re-auth rather than hammering a 401 on every foreground.
    if (state === 'idle' && status?.lastError) startedRef.current = false;
    // Everything the sync writes hangs off this channel, so one refresh wakes
    // the profile, sport-settings and wellness readers together.
    getRouteEngine()?.triggerRefresh('activities');
    // The exclusive slot is free again. Anything the sync refused while it held
    // it gets its one chance to ask now.
    emitSyncSettled();
    // The widget's other writers are backgrounding and the silent-push task, so
    // without this a foreground sync leaves the home screen on yesterday's
    // numbers. A sync that failed part-way still wrote what it did fetch, so the
    // error path refreshes too.
    updateWidgetSnapshot();
  }, [state, status?.lastError]);

  const retry = () => setRetryNonce((nonce) => nonce + 1);
  useReconnect(retry);
  useForeground(retry);
}
