import { useEffect } from 'react';

import { useSyncDateRange } from './SyncDateRangeStore';
import { PICKUP_DEADLINE_MS } from './extendedFetch';

export function usePickupDeadline(): void {
  const expirePickup = useSyncDateRange((state) => state.expirePickup);
  const phase = useSyncDateRange((state) => state.extendedFetch.phase);
  const since = useSyncDateRange((state) => state.extendedFetch.since);

  useEffect(() => {
    if (phase !== 'awaitingPickup') return undefined;
    const remaining = Math.max(0, PICKUP_DEADLINE_MS - (Date.now() - since));
    const timer = setTimeout(expirePickup, remaining);
    return () => clearTimeout(timer);
  }, [expirePickup, phase, since]);
}
