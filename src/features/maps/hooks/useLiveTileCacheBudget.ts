import { useEffect } from 'react';

import { onTileCacheBudget } from '@/features/maps/lib/terrainSnapshotEvents';
import { applyTileCacheBudgetScript } from '@/features/maps/lib/tileCacheBudget';

/**
 * Send a changed tile cache ceiling into a page that is already open.
 *
 * Both interactive surfaces bake the budget into their HTML when they build
 * it, so without this a lowered ceiling did nothing until the app was
 * relaunched. The snapshot pool subscribes too, but it is torn down whenever
 * the feed is not focused, which is exactly when the settings screen is up, so
 * it was never the surface that could take the change.
 *
 * `inject` must be stable, or the subscription is rebuilt on every render.
 */
export function useLiveTileCacheBudget(inject: (script: string) => void): void {
  useEffect(() => {
    return onTileCacheBudget((budgetMb) => inject(applyTileCacheBudgetScript(budgetMb)));
  }, [inject]);
}
