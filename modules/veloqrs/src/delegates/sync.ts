/**
 * Sync service delegates.
 *
 * Thin wrappers over the Rust `SyncManager` FFI object (the single first-class
 * I/O contract). TypeScript sets credentials once, issues commands, and reads a
 * status snapshot — it never builds an axios request or an auth header itself.
 *
 * Runtime note: `host.engine.sync()` resolves once the UniFFI bindings are
 * regenerated for the new `SyncManager` object (clean rebuild — see
 * modules/veloqrs/CLAUDE.md "FFI Development Rules"). Until then these no-op via
 * the `host.ready` guard. Field casing matches the generated records (camelCase).
 */

import type { DelegateHost } from './host';

/** Auth scheme passed to `setSyncCredentials` (matches Rust `AuthKind::parse`). */
export type SyncAuthMethod = 'oauth' | 'api_key';

/** Mirror of the Rust `FfiSyncStatus` record. Replace with the generated
 *  `FfiSyncStatus` type once bindings are regenerated. */
export interface SyncStatus {
  state: 'idle' | 'syncing' | 'paused' | 'authExpired';
  inFlight: number;
  completed: number;
  total: number;
  lastError: string | null;
}

/** Set the credential once. Never passed per request. */
export function setSyncCredentials(
  host: DelegateHost,
  method: SyncAuthMethod,
  secret: string,
  athleteId: string
): void {
  if (!host.ready) return;
  host.timed('setSyncCredentials', () =>
    host.engine.sync().setCredentials(method, secret, athleteId)
  );
}

/** Forget the credential (logout). */
export function clearSyncCredentials(host: DelegateHost): void {
  if (!host.ready) return;
  host.timed('clearSyncCredentials', () => host.engine.sync().clearCredentials());
}

/** Start a sync. Returns instantly; false if one is already running or no
 *  credentials are set. Progress surfaces through `getSyncStatus`. */
export function syncNow(host: DelegateHost): boolean {
  if (!host.ready) return false;
  const started = host.timed('syncNow', () => host.engine.sync().syncNow()) as boolean;
  if (started) host.notify('sync');
  return started;
}

/** Soft-cancel the running sync. */
export function cancelSync(host: DelegateHost): void {
  if (!host.ready) return;
  host.timed('cancelSync', () => host.engine.sync().cancel());
  host.notify('sync');
}

/** Current status snapshot (null before the engine is ready). */
export function getSyncStatus(host: DelegateHost): SyncStatus | null {
  if (!host.ready) return null;
  return (host.timed('getSyncStatus', () => host.engine.sync().getSyncStatus()) ??
    null) as SyncStatus | null;
}
