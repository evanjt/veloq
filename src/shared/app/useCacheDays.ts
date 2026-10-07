/**
 * Hook to get the number of days of cached activity data.
 * Uses the sync date range store as the source of truth.
 * This consolidates the cache days calculation used across multiple pages.
 */
import { useMemo } from 'react';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { readLibraryCount } from '@/shared/native/libraryCount';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { DEFAULT_ACTIVITY_DAYS } from '@/shared/native/activityWindow.generated';

/**
 * Returns the number of days of cached activity data.
 * Uses calendar days (includes both start and end date).
 *
 * `preComputedActivityCount` lets a caller that already read the count as part
 * of a screen bundle skip this hook's own FFI call.
 *
 * @returns Number of days, or the default activity window when no data
 */
export function useCacheDays(preComputedActivityCount?: number): number {
  const oldest = useSyncDateRange((s) => s.oldest);
  const newest = useSyncDateRange((s) => s.newest);
  const readActivities = useEngineRead(['activities']);

  return useMemo(() => {
    // Check if we have any activities in the engine
    const activityCount =
      preComputedActivityCount ?? readActivities((engine) => readLibraryCount(engine)) ?? 0;

    if (activityCount === 0 || !oldest || !newest) {
      return DEFAULT_ACTIVITY_DAYS;
    }

    // Parse ISO date strings
    const oldestDate = new Date(oldest);
    const newestDate = new Date(newest);

    // Use calendar days (ignoring time) for accurate day counting
    const oldestDay = new Date(
      oldestDate.getFullYear(),
      oldestDate.getMonth(),
      oldestDate.getDate()
    );
    const newestDay = new Date(
      newestDate.getFullYear(),
      newestDate.getMonth(),
      newestDate.getDate()
    );

    // Calculate days difference and add 1 to include both start and end days
    const diffMs = newestDay.getTime() - oldestDay.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;

    return diffDays;
  }, [oldest, newest, preComputedActivityCount, readActivities]);
}
