/**
 * Hook for managing activity retention and cleanup.
 *
 * This hook provides automatic cleanup of old activities to prevent
 * unbounded database growth. It integrates with user preferences
 * to determine the retention period.
 */

import { useState, useCallback } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';

interface CleanupState {
  /** Number of activities deleted in last cleanup */
  deletedCount: number;
  /** Whether cleanup is currently running */
  isCleaning: boolean;
  /** Error message if cleanup failed */
  error: string | null;
}

interface UseRetentionCleanupResult {
  /** Current cleanup state */
  state: CleanupState;
  /** Manually trigger cleanup with custom retention days */
  cleanup: (retentionDays?: number) => Promise<number>;
  /** Get the retention period from user preferences */
  getRetentionDays: () => Promise<number>;
}

/**
 * Hook for managing activity retention cleanup.
 *
 * Automatically cleans up activities older than the retention period
 * to prevent database bloat. Default retention is 90 days.
 *
 * @example
 * ```tsx
 * function Settings() {
 *   const { state, cleanup, getRetentionDays } = useRetentionCleanup();
 *
 *   const handleCleanup = async () => {
 *     const days = await getRetentionDays();
 *     const deleted = await cleanup(days);
 *     console.log(`Deleted ${deleted} old activities`);
 *   };
 *
 *   return (
 *     <Button onPress={handleCleanup} disabled={state.isCleaning}>
 *       {state.isCleaning ? 'Cleaning...' : 'Clean Old Activities'}
 *     </Button>
 *   );
 * }
 * ```
 */
export function useRetentionCleanup(): UseRetentionCleanupResult {
  const [state, setState] = useState<CleanupState>({
    deletedCount: 0,
    isCleaning: false,
    error: null,
  });

  /**
   * Get retention period from user preferences.
   * Returns 90 days if not set.
   */
  const getRetentionDays = useCallback(async (): Promise<number> => {
    try {
      // Import dynamically to avoid circular dependencies
      const { getRetentionDays } = await import('@/providers/RouteSettingsStore');
      const retentionDays = getRetentionDays();

      // Validate and return retention period
      if (retentionDays && retentionDays >= 30) {
        return retentionDays;
      }

      // Default to 90 days
      return 90;
    } catch (error) {
      console.warn('[useRetentionCleanup] Failed to get retention days:', error);
      return 90; // Fallback to default
    }
  }, []);

  /**
   * Trigger cleanup of old activities.
   *
   * @param retentionDays - Number of days to retain (optional, defaults to preference)
   * @returns Number of activities deleted
   */
  const cleanup = useCallback(
    async (retentionDays?: number): Promise<number> => {
      const engine = getRouteEngine();
      if (!engine) {
        setState((prev) => ({
          ...prev,
          error: 'Route engine not initialized',
        }));
        return 0;
      }

      setState((prev) => ({
        ...prev,
        isCleaning: true,
        error: null,
      }));

      try {
        // Use provided retention days or get from preferences
        const days = retentionDays ?? (await getRetentionDays());

        console.log(`[useRetentionCleanup] Starting cleanup (retention: ${days} days)`);

        // Call cleanup function
        const deleted = engine.cleanupOldActivities(days);

        setState({
          deletedCount: deleted,
          isCleaning: false,
          error: null,
        });

        console.log(`[useRetentionCleanup] Completed: ${deleted} activities removed`);
        return deleted;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error during cleanup';

        console.error('[useRetentionCleanup] Cleanup failed:', error);

        setState({
          deletedCount: 0,
          isCleaning: false,
          error: errorMessage,
        });

        return 0;
      }
    },
    [getRetentionDays]
  );

  return {
    state,
    cleanup,
    getRetentionDays,
  };
}
