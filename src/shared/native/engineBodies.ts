/**
 * Read a body the Rust sync stores on demand, asking for it when it is absent.
 *
 * Curves, activity intervals and calendar events are per-parameter fetches, so
 * the launch sync cannot prefetch them. The read returns what is stored;
 * `null` means "never fetched", which is the cue to request it. Rust folds
 * duplicate requests together, and announces the landing on `bodyStored`,
 * which wakes the query that asked. Nothing is read on a timer: between the
 * request and the event this costs no engine call at all.
 */
import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { getEngine } from './engine';

/**
 * What announces a body. `bodyStored` is the on-demand landing, `activities`
 * the coarse channel a full sync fans out on.
 */
const CHANNELS = ['bodyStored', 'activities'] as const;

/**
 * Request `resource` once per mount-with-these-parameters when `present` is
 * false, and invalidate `queryKey` when the engine reports a change.
 */
export function useEngineBody(
  present: boolean,
  request: () => void,
  queryKey: QueryKey,
  enabled = true
): void {
  const queryClient = useQueryClient();
  const keyId = JSON.stringify(queryKey);

  useEffect(() => {
    if (!enabled || present) return;
    request();
    // `request` closes over the parameters already encoded in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, present, keyId]);

  useEffect(() => {
    if (!enabled) return;
    const engine = getEngine();
    if (!engine) return;
    const invalidate = () => queryClient.invalidateQueries({ queryKey });
    const unsubscribes = CHANNELS.map((channel) => engine.subscribe(channel, invalidate));
    return () => unsubscribes.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, queryClient, keyId]);
}
