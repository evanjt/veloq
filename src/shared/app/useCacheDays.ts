/**
 * Hook to get the number of days of cached activity data.
 * Uses the sync date range store as the source of truth.
 * This consolidates the cache days calculation used across multiple pages.
 */
import { useMemo } from 'react';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { readLibraryCount } from '@/shared/native/libraryCount';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { calendarDaysBetween } from '@/shared/format/format';
import { DEFAULT_ACTIVITY_DAYS } from '@/shared/native/activityWindow.generated';

/**
 * Returns the number of days of cached activity data.
 * Uses calendar days (includes both start and end date).
 *
 * `preComputedActivityCount` lets a caller that already read the count as part
 * of a screen bundle skip this hook's own FFI call.
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

    // Plus one to include both the first and the last day
    return calendarDaysBetween(new Date(oldest), new Date(newest)) + 1;
  }, [oldest, newest, preComputedActivityCount, readActivities]);
}
