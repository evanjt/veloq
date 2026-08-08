/**
 * The athlete profile comes from SQLite, not the API.
 *
 * Rust's sync service stores the raw intervals.icu body, so the unit
 * preferences this hook reads (`measurement_preference`, `fahrenheit`,
 * `wind_speed`) survive even though no Rust type models them.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';
import type { Athlete } from '@/types';

function readAthlete(): Athlete | null {
  const engine = getRouteEngine();
  if (!engine) return null;
  const json = engine.getAthleteProfile();
  if (!json) return null;
  try {
    return JSON.parse(json) as Athlete;
  } catch {
    return null;
  }
}

export function useAthlete() {
  const setAthlete = useAuthStore((state) => state.setAthlete);
  const setIntervalsPreferences = useUnitPreference((state) => state.setIntervalsPreferences);
  useEngineChannel('activities', queryKeys.profile.athlete);

  const query = useQuery({
    queryKey: queryKeys.profile.athlete,
    queryFn: readAthlete,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24,
  });

  useEffect(() => {
    if (query.data) {
      setAthlete(query.data);

      // Extract unit preferences from athlete data if available
      // These fields come from the intervals.icu API but aren't typed in Athlete
      const athleteData = query.data as unknown as Record<string, unknown>;
      if ('measurement_preference' in athleteData) {
        setIntervalsPreferences({
          measurementPreference:
            (athleteData.measurement_preference as string) === 'feet' ? 'feet' : 'meters',
          fahrenheit: Boolean(athleteData.fahrenheit),
          windSpeed: (athleteData.wind_speed as 'KMH' | 'MPH' | 'MS') || 'KMH',
        });
      }
    }
  }, [query.data, setAthlete, setIntervalsPreferences]);

  return query;
}
