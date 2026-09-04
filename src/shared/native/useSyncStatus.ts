/**
 * Subscribe to the Rust sync service status.
 *
 * Reads `SyncManager.get_sync_status()` via the engine, once at mount and then
 * only when the engine announces a step or a settle. The command + status
 * boundary means the JS thread never blocks on I/O, so this hook only ever
 * reads a cheap snapshot.
 */
import { useEffect, useState } from 'react';
import { getEngine } from './engine';
import type { SyncStatus } from 'veloqrs';

/** What the sync service announces: every step, and the terminal transition. */
const CHANNELS = ['sync', 'syncProgress', 'syncSettled'] as const;

export function useSyncStatus(): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    const engine = getEngine();
    if (!engine) return;

    const read = () => setStatus(engine.getSyncStatus());
    read();
    const unsubscribes = CHANNELS.map((channel) => engine.subscribe(channel, read));
    return () => unsubscribes.forEach((off) => off());
  }, []);

  return status;
}
