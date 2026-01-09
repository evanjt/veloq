/**
 * Hook for getting the oldest activity date
 */

import { useMemo } from 'react';
import { useActivities } from './activities';

/** Get the oldest activity date from the user's activities */
export function useOldestActivityDate(activityType?: string) {
  const { data: activities } = useActivities({ days: 365, includeStats: false });

  const data = useMemo(() => {
    if (!activities || activities.length === 0) {
      return null;
    }

    // Filter by activity type if provided
    const filtered = activityType
      ? activities.filter((a) => a.type === activityType)
      : activities;

    if (filtered.length === 0) {
      return null;
    }

    // Find oldest activity
    const oldest = filtered.reduce((oldest, current) => {
      const oldestDate = new Date(oldest.start_date_local);
      const currentDate = new Date(current.start_date_local);
      return currentDate < oldestDate ? current : oldest;
    });

    return new Date(oldest.start_date_local);
  }, [activities, activityType]);

  return { data };
}
