/**
 * Subscribe to the Rust sync service status.
 *
 * Reads `SyncManager.get_sync_status()` via the engine, refreshing on the `sync`
 * notify channel and polling only while a sync is in flight. The command +
 * status boundary means the JS thread never blocks on I/O, so this hook only
 * ever reads a cheap snapshot.
 */
import { useEffect, useState } from 'react';
import { getRouteEngine } from './routeEngine';
import type { SyncStatus } from 'veloqrs';

export function useSyncStatus(pollMs = 1500): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  // Always-on subscription: a status change pushed over the `sync` channel
  // (e.g. a `sync_now` command) refreshes the snapshot on the next microtask.
  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;

    const read = () => setStatus(engine.getSyncStatus());
    read();
    return engine.subscribe('sync', read);
  }, []);

  // Poll only while a sync is in flight. The background job settles on a Rust
  // thread without emitting a notify, so polling is how the terminal state and
  // advancing counters reach the UI. An idle service needs no timer. Polling it
  // would re-render every tick, since each snapshot is a fresh object.
  useEffect(() => {
    if (status?.state !== 'syncing') return;
    const engine = getRouteEngine();
    if (!engine) return;

    const interval = setInterval(() => setStatus(engine.getSyncStatus()), pollMs);
    return () => clearInterval(interval);
  }, [status?.state, pollMs]);

  return status;
}
