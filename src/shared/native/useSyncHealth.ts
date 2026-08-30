/**
 * Report whether the sync is reaching intervals.icu, and when one last did.
 *
 * `isOnline` only says the radio is up. A captive portal, a DNS black hole or a
 * sustained 5xx all leave the device connected while every sync fails, and the
 * engine's `lastError` had no renderer, so the app looked empty rather than
 * broken. The success time is kept in engine settings because the relaunch is
 * exactly the case where the error alone says nothing: a fresh process has no
 * error yet and no memory of the last time data arrived.
 */
import { useEffect, useRef, useState } from 'react';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';

import { getRouteEngine } from './routeEngine';
import { useSyncStatus } from './useSyncStatus';

/** Engine settings key holding the ISO time of the last sync that landed. */
export const LAST_SUCCESS_KEY = 'sync.last_success_at';

export interface SyncHealth {
  /** The error the last sync settled with, or null while it is healthy. */
  lastError: string | null;
  /** ISO time of the last sync that completed cleanly, or null if none has. */
  lastSuccessAt: string | null;
}

export function useSyncHealth(): SyncHealth {
  const status = useSyncStatus();
  const state = status?.state;
  const lastError = status?.lastError ?? null;
  const engineReadyNonce = useEngineStatus((s) => s.readyNonce);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const wasSyncingRef = useRef(false);

  // This hook mounts before the root layout opens the engine, so the first read
  // reaches a null handle. The ready nonce brings it back with a real one.
  useEffect(() => {
    const stored = getRouteEngine()?.getSetting(LAST_SUCCESS_KEY);
    if (stored) setLastSuccessAt(stored);
  }, [engineReadyNonce]);

  useEffect(() => {
    if (state === 'syncing') {
      wasSyncingRef.current = true;
      return;
    }
    if (!wasSyncingRef.current) return;
    wasSyncingRef.current = false;
    // `authExpired` and `paused` are not arrivals, and neither is an idle run
    // that carried an error, so none of them may move the success time.
    if (state !== 'idle' || lastError) return;
    const at = new Date().toISOString();
    getRouteEngine()?.setSetting(LAST_SUCCESS_KEY, at);
    setLastSuccessAt(at);
  }, [state, lastError]);

  return { lastError, lastSuccessAt };
}
