/**
 * Report whether the sync is reaching intervals.icu, and when one last did.
 *
 * `isOnline` only says the radio is up. A captive portal, a DNS black hole or a
 * sustained 5xx all leave the device connected while every sync fails, and the
 * engine's `lastError` had no renderer, so the app looked empty rather than
 * broken. The success time is the engine's own, stamped when a sync settles
 * clean and persisted, so a fresh process after a relaunch still has it.
 */
import type { FfiSyncErrorReason } from 'veloqrs';

import {
  useLastSyncSuccessAt,
  useSyncLastError,
  useSyncLastErrorReason,
  useSyncRetryAtMs,
} from './useSyncStatus';

interface SyncHealth {
  /** The error the last sync settled with, or null while it is healthy. */
  lastError: string | null;
  /**
   * Which kind of failure `lastError` describes. The engine classifies it, so
   * the banner can name it in the athlete's language instead of printing the
   * engine's own English.
   */
  lastErrorReason: FfiSyncErrorReason | null;
  /** ISO time of the last sync that completed cleanly, or null if none has. */
  lastSuccessAt: string | null;
  /**
   * When intervals.icu or the request budget lets the sync ask again, as epoch
   * milliseconds, when the last run ended on a refusal. The engine resumes on
   * its own then, so this is a pause and not a failure.
   */
  retryAtMs: number | null;
}

export function useSyncHealth(): SyncHealth {
  // Per-field reads: the whole snapshot moves on every progress step, and these four do not.
  const lastError = useSyncLastError();
  const lastErrorReason = useSyncLastErrorReason();
  const lastSuccessAt = useLastSyncSuccessAt();
  const retryAtMs = useSyncRetryAtMs();
  return {
    lastError: lastError ?? null,
    lastErrorReason,
    lastSuccessAt,
    retryAtMs,
  };
}
