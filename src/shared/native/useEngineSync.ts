/**
 * Drive the Rust sync service and wake the readers when it settles.
 *
 * The engine-backed hooks read SQLite, so something has to fill it and
 * something has to tell them it changed. `syncNow` is the first half. The
 * second is the transition out of `syncing`: the job finishes on a Rust
 * thread, which cannot reach the TypeScript listener map, so the terminal
 * state observed here is what fans the change out over the engine channel.
 *
 * Demo mode holds no credential, so it skips the sync entirely and reads the
 * rows `seedDemoEngine` wrote.
 */
import { useEffect, useRef } from 'react';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useAuthStore } from '@/shared/app/AuthStore';

import { getRouteEngine } from './routeEngine';
import { useSyncStatus } from './useSyncStatus';

export function useEngineSync(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const state = useSyncStatus()?.state;
  const engineReadyNonce = useEngineStatus((s) => s.readyNonce);
  const startedRef = useRef(false);
  const wasSyncingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || isDemoMode || startedRef.current) return;
    const engine = getRouteEngine();
    if (!engine) return;
    // This hook mounts before the root layout has opened the engine, so the
    // first call reaches a null handle and returns false without touching
    // Rust. Latching on the return value keeps the retry alive until the
    // ready nonce brings the effect back with a real engine.
    startedRef.current = engine.syncNow();
  }, [isAuthenticated, isDemoMode, engineReadyNonce]);

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
    // Everything the sync writes hangs off this channel, so one refresh wakes
    // the profile, sport-settings and wellness readers together.
    getRouteEngine()?.triggerRefresh('activities');
  }, [state]);
}
