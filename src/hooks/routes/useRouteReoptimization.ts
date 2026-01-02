/**
 * Hook for automatic route re-optimization when cache expands.
 *
 * When the user expands their date range (e.g., from 90 days to 365 days),
 * historical activities are fetched and added to the route engine. This hook
 * detects the expansion and triggers route re-computation to improve route
 * quality with the new data.
 */

import { useEffect } from 'react';
import { useSyncDateRange } from '@/providers/SyncDateRangeStore';
import { getRouteEngine } from '@/lib/native/routeEngine';

/**
 * Hook for automatic route re-optimization on cache expansion.
 *
 * Monitors the sync date range for expansions (when user adds historical data)
 * and triggers route re-computation to improve route quality.
 *
 * @example
 * ```tsx
 * function App() {
 *   useRouteReoptimization();
 *   // ... rest of app
 * }
 * ```
 */
export function useRouteReoptimization() {
  const { hasExpanded, markExpansionProcessed } = useSyncDateRange();

  useEffect(() => {
    if (!hasExpanded) return;

    const engine = getRouteEngine();
    if (!engine) {
      console.warn('[useRouteReoptimization] Engine not initialized');
      return;
    }

    console.log('[useRouteReoptimization] Cache expansion detected, marking for re-computation');

    // Mark engine for re-computation
    engine.markForRecomputation();

    // Mark expansion as processed
    markExpansionProcessed();
  }, [hasExpanded, markExpansionProcessed]);
}
