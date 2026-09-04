/**
 * Subscribe to an engine change channel and refetch a query group when it fires.
 *
 * `useEngineSubscription` in `features/routes` does the same job, but it is
 * reached through a module chain that imports the native binding statically.
 * Shared hooks pull that chain into every consumer, so this one goes through
 * the lazy `getEngine` loader instead.
 */
import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { getEngine } from './engine';

export function useEngineChannel(event: string, queryKey: QueryKey): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const engine = getEngine();
    if (!engine) return;
    return engine.subscribe(event, () => {
      queryClient.invalidateQueries({ queryKey });
    });
    // The key is a literal tuple from queryKeys, stable across renders by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, queryClient, JSON.stringify(queryKey)]);
}
