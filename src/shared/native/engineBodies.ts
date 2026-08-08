/**
 * Read a body the Rust sync stores on demand, asking for it when it is absent.
 *
 * Curves, activity intervals and calendar events are per-parameter fetches, so
 * the launch sync cannot prefetch them. The read returns what is stored;
 * `null` means "never fetched", which is the cue to request it. Rust folds
 * duplicate requests together, and the engine event wakes the query when the
 * body lands.
 */
import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { getRouteEngine } from './routeEngine';

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
    const engine = getRouteEngine();
    if (!engine) return;
    return engine.subscribe('activities', () => {
      queryClient.invalidateQueries({ queryKey });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, queryClient, keyId]);
}
