/**
 * Report whether the sync is reaching intervals.icu, and when one last did.
 *
 * `isOnline` only says the radio is up. A captive portal, a DNS black hole or a
 * sustained 5xx all leave the device connected while every sync fails, and the
 * engine's `lastError` had no renderer, so the app looked empty rather than
 * broken. The success time is the engine's own, stamped when a sync settles
 * clean and persisted, so a fresh process after a relaunch still has it.
 */
import type { SyncErrorReason } from 'veloqrs';

import { useSyncStatus } from './useSyncStatus';

export interface SyncHealth {
  /** The error the last sync settled with, or null while it is healthy. */
  lastError: string | null;
  /**
   * Which kind of failure `lastError` describes. The engine classifies it, so
   * the banner can name it in the athlete's language instead of printing the
   * engine's own English.
   */
  lastErrorReason: SyncErrorReason | null;
  /** ISO time of the last sync that completed cleanly, or null if none has. */
  lastSuccessAt: string | null;
}

export function useSyncHealth(): SyncHealth {
  const status = useSyncStatus();
  return {
    lastError: status?.lastError ?? null,
    lastErrorReason: status?.lastErrorReason ?? null,
    lastSuccessAt: status?.lastSuccessAt ?? null,
  };
}
