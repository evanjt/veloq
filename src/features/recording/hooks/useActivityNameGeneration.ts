import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActivityType } from '@/types';

export type TimeOfDayKey = 'morning' | 'afternoon' | 'evening' | 'night';

/** The local time-of-day bucket of the hour the activity started, or of now when it has none. */
export function getTimeOfDayKey(startTime: number | null): TimeOfDayKey {
  const hour = new Date(startTime ?? Date.now()).getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

export interface UseActivityNameGenerationArgs {
  /** Pre-specified name from route params (takes precedence if provided). */
  initialName?: string | undefined;
  /** Activity type used to generate the default name. */
  type: ActivityType;
  /** When the ride started, epoch ms; null for a manual entry, which is named from now. */
  startTime: number | null;
}

export interface UseActivityNameGeneration {
  name: string;
  setName: (name: string) => void;
}

/**
 * Manages the activity name state, seeding a default name on first render
 * based on the start time-of-day and activity type (e.g. "Morning Ride").
 *
 * If `initialName` is provided (typically from route params), it takes
 * precedence over the generated default. The user can freely edit the name
 * afterwards via the returned `setName`.
 *
 * Generation runs only once, in the state initialiser, so the field carries a
 * name on the very first render rather than committing an empty one and
 * replacing it. Subsequent prop changes do not overwrite user edits.
 */
export function useActivityNameGeneration({
  initialName,
  type,
  startTime,
}: UseActivityNameGenerationArgs): UseActivityNameGeneration {
  const { t } = useTranslation();
  const [name, setName] = useState(() => {
    if (initialName) return initialName;
    const tod = getTimeOfDayKey(startTime);
    return `${t(`recording.timeOfDay.${tod}`)} ${t(`activityTypes.${type}`, type.replace(/([A-Z])/g, ' $1').trim())}`;
  });

  return { name, setName };
}
