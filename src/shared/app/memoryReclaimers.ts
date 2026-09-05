import { queryClient } from '@/shared/query/QueryProvider';

import { registerReclaimer, TRIM_COMPLETE, TRIM_UI_HIDDEN } from './memoryPressure';

/**
 * Every query key is rebuilt from SQLite, so the cache is the cheapest thing to give
 * back. Below `TRIM_MEMORY_COMPLETE` only the unobserved keys go, which leaves the
 * mounted screens intact; at the last warning the whole cache goes.
 */
export function registerQueryCacheReclaimer(): () => void {
  return registerReclaimer({
    name: 'query-cache',
    minLevel: TRIM_UI_HIDDEN,
    release: (level) => {
      if (level >= TRIM_COMPLETE) {
        queryClient.clear();
      } else {
        queryClient.removeQueries({ type: 'inactive' });
      }
    },
  });
}
