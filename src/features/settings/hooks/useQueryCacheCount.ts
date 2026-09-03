/**
 * How many queries TanStack is holding, for the cache screen's readout.
 *
 * The count used to be a `useMemo` over `[queryClient]`, which is stable for
 * the life of the app, so it froze at whatever the cache held the first time
 * the screen mounted. Subscribing gives a live number. The throttle is what
 * the frozen reading was trading for: a sync that lands a hundred queries
 * costs one re-render rather than a hundred.
 */

import { useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';

export const QUERY_COUNT_THROTTLE_MS = 1000;

export function useQueryCacheCount(queryClient: QueryClient): number {
  const [count, setCount] = useState(() => queryClient.getQueryCache().getAll().length);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const sample = () => {
      pendingRef.current = null;
      setCount(cache.getAll().length);
    };
    // Every path samples through the timer, the resync after a client swap
    // included, so the count never lands synchronously inside the effect.
    const schedule = () => {
      if (pendingRef.current) return;
      pendingRef.current = setTimeout(sample, QUERY_COUNT_THROTTLE_MS);
    };

    schedule();
    const unsubscribe = cache.subscribe(schedule);

    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = null;
      unsubscribe();
    };
  }, [queryClient]);

  return count;
}
