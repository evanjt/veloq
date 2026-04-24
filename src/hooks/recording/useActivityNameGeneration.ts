import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityType } from '@/types';

export type TimeOfDayKey = 'morning' | 'afternoon' | 'evening' | 'night';

/** Returns the time-of-day bucket for the current hour. */
export function getTimeOfDayKey(): TimeOfDayKey {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

export interface UseActivityNameGenerationArgs {
  /** Pre-specified name from route params (takes precedence if provided). */
  initialName?: string;
  /** Activity type used to generate the default name. */
  type: ActivityType;
}

export interface UseActivityNameGeneration {
  name: string;
  setName: (name: string) => void;
}

/**
 * Manages the activity name state, seeding a default name on first render
 * based on the current time-of-day and activity type (e.g. "Morning Ride").
 *
 * If `initialName` is provided (typically from route params), it takes
 * precedence over the generated default. The user can freely edit the name
 * afterwards via the returned `setName`.
 *
 * Generation runs only once on mount — subsequent prop changes do not
 * overwrite user edits.
 */
export function useActivityNameGeneration({
  initialName,
  type,
}: UseActivityNameGenerationArgs): UseActivityNameGeneration {
  const { t } = useTranslation();
  const [name, setName] = useState('');

  useEffect(() => {
    if (initialName) {
      setName(initialName);
      return;
    }

    const tod = getTimeOfDayKey();
    const defaultName = `${t(`recording.timeOfDay.${tod}`)} ${t(`activityTypes.${type}`, type.replace(/([A-Z])/g, ' $1').trim())}`;
    setName(defaultName);

    // Geocoding disabled for Nominatim ToS compliance.
    // See: https://operations.osmfoundation.org/policies/nominatim/
    // Will re-enable once a caching proxy is in place.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { name, setName };
}
