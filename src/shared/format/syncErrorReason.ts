/**
 * The line that names why the last sync failed.
 *
 * The engine's own message is never what an athlete reads. It is written in
 * English, in the engine's vocabulary, and it changes whenever a message is
 * reworded. The engine classifies the failure instead, and the reason it hands
 * over picks a translated line. The sync banner and the empty feed both name
 * the failure, so they read it from this one table.
 */

import { FfiSyncErrorReason } from 'veloqrs';

/** The line each reason names. Written out so the key type checks. */
export const SYNC_ERROR_REASON_KEY = {
  [FfiSyncErrorReason.Unauthorized]: 'emptyState.syncError.reason.unauthorized',
  [FfiSyncErrorReason.RateLimited]: 'emptyState.syncError.reason.rateLimited',
  [FfiSyncErrorReason.Server]: 'emptyState.syncError.reason.server',
  [FfiSyncErrorReason.Network]: 'emptyState.syncError.reason.network',
  [FfiSyncErrorReason.Storage]: 'emptyState.syncError.reason.storage',
  [FfiSyncErrorReason.NotConfigured]: 'emptyState.syncError.reason.notConfigured',
  [FfiSyncErrorReason.Internal]: 'emptyState.syncError.reason.internal',
  [FfiSyncErrorReason.EngineClosed]: 'emptyState.syncError.reason.engineClosed',
  [FfiSyncErrorReason.StorageFull]: 'emptyState.syncError.reason.storageFull',
} as const satisfies Record<FfiSyncErrorReason, string>;
