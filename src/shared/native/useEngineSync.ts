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

import { useAuthStore } from '@/shared/app/AuthStore';

import { getRouteEngine } from './routeEngine';
import { useSyncStatus } from './useSyncStatus';

export function useEngineSync(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const state = useSyncStatus()?.state;
  const startedRef = useRef(false);
  const wasSyncingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || isDemoMode || startedRef.current) return;
    const engine = getRouteEngine();
    if (!engine) return;
    startedRef.current = true;
    engine.syncNow();
  }, [isAuthenticated, isDemoMode]);

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
