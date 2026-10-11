/**
 * The line that names why the last sync failed.
 *
 * The engine's own message is never what an athlete reads. It is written in
 * English, in the engine's vocabulary, and it changes whenever a message is
 * reworded. The engine classifies the failure instead, and the reason it hands
 * over picks a translated line. The sync banner and the empty feed both name
 * the failure, so they read it from this one table.
 */

import { SyncErrorReason } from 'veloqrs';

/** The line each reason names. Written out so the key type checks. */
export const SYNC_ERROR_REASON_KEY = {
  [SyncErrorReason.Unauthorized]: 'emptyState.syncError.reason.unauthorized',
  [SyncErrorReason.RateLimited]: 'emptyState.syncError.reason.rateLimited',
  [SyncErrorReason.Server]: 'emptyState.syncError.reason.server',
  [SyncErrorReason.Network]: 'emptyState.syncError.reason.network',
  [SyncErrorReason.Storage]: 'emptyState.syncError.reason.storage',
  [SyncErrorReason.NotConfigured]: 'emptyState.syncError.reason.notConfigured',
  [SyncErrorReason.Internal]: 'emptyState.syncError.reason.internal',
  [SyncErrorReason.EngineClosed]: 'emptyState.syncError.reason.engineClosed',
} as const satisfies Record<SyncErrorReason, string>;
