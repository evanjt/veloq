/**
 * Subscribe to the Rust sync service status.
 *
 * Reads `SyncManager.get_sync_status()` via the engine, refreshing on the `sync`
 * notify channel and polling while a sync is in flight so the in-flight /
 * completed counters advance. The command + status boundary means the JS thread
 * never blocks on I/O — this hook only ever reads a cheap snapshot.
 */
import { useEffect, useState } from 'react';
import { getRouteEngine } from './routeEngine';
import type { SyncStatus } from 'veloqrs';

export function useSyncStatus(pollMs = 1500): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;

    const read = () => setStatus(engine.getSyncStatus());
    read();

    const unsubscribe = engine.subscribe('sync', read);
    // Poll while syncing so counters advance even without an explicit notify.
    const interval = setInterval(read, pollMs);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [pollMs]);

  return status;
}
