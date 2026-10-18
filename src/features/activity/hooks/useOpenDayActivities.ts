import { useCallback } from 'react';

import type { DayActivitiesInput } from '@/app/sheets/day-activities';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import { navigateTo } from '@/shared/app/navigation';
import type { FeedCard } from '@/types';

export type DayActivity = DayActivitiesInput['activities'][number];

/** A feed card as the day picker lists it. */
export function dayActivityRow(card: FeedCard): DayActivity {
  return {
    id: card.id,
    name: card.name,
    type: card.sportType ?? 'Other',
    load: card.trainingLoad ?? 0,
    startDateLocal: card.startDateLocal,
    movingTime: card.movingTime ?? 0,
    distance: card.distance ?? 0,
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
        navigateTo(`/activity/${first.id}`);
        return true;
      }
      const result = await openSheet<DayActivitiesInput, string>('sheets/day-activities', {
        activities,
      });
      if (result.kind !== 'selected') return false;
      navigateTo(`/activity/${result.value}`);
      return true;
    },
    [openSheet]
  );
}
