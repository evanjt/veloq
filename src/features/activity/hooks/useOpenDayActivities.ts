import { useCallback } from 'react';

import type { DayActivitiesInput } from '@/app/sheets/day-activities';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import { tapTo } from '@/shared/app/navigation';
import type { Activity } from '@/types';

export type DayActivity = DayActivitiesInput['activities'][number];

/** An activity as the day picker lists it. */
export function dayActivityRow(activity: Activity): DayActivity {
  return {
    id: activity.id,
    name: activity.name,
    type: activity.type,
    load: activity.icu_training_load || 0,
    startDateLocal: activity.start_date_local,
    movingTime: activity.moving_time,
    distance: activity.distance,
  };
}

/**
 * Opens one day's activities: the activity itself when there is one, the day
 * picker and then the chosen activity when there are several. Answers whether
 * an activity was opened, false for an empty day or a dismissed picker.
 */
export function useOpenDayActivities(): (activities: DayActivity[]) => Promise<boolean> {
  const openSheet = useSheetOpener();
  return useCallback(
    async (activities: DayActivity[]) => {
      const [first] = activities;
      if (!first) return false;
      if (activities.length === 1) {
        tapTo(`/activity/${first.id}`);
        return true;
      }
      const result = await openSheet<DayActivitiesInput, string>('sheets/day-activities', {
        activities,
      });
      if (result.kind !== 'selected') return false;
      tapTo(`/activity/${result.value}`);
      return true;
    },
    [openSheet]
  );
}
