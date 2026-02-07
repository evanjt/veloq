import { useQuery } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { useAuthStore, useUnitPreference } from '@/providers';
import { useEffect, useMemo } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { Athlete } from '@/types';

export function useAthlete() {
  const setAthlete = useAuthStore((state) => state.setAthlete);
  const setIntervalsPreferences = useUnitPreference((state) => state.setIntervalsPreferences);

  // Load cached athlete profile from engine for instant first render
  const cachedAthlete = useMemo<Athlete | undefined>(() => {
    const engine = getRouteEngine();
    if (!engine) return undefined;
    const json = engine.getAthleteProfile();
    if (!json) return undefined;
    try {
      return JSON.parse(json) as Athlete;
    } catch {
      return undefined;
    }
  }, []);

  const query = useQuery({
    queryKey: ['athlete'],
    queryFn: async () => {
      const profile = await intervalsApi.getAthlete();
      // Update engine cache on successful fetch
      const engine = getRouteEngine();
      if (engine) {
        try {
          engine.setAthleteProfile(JSON.stringify(profile));
        } catch {
          // Ignore engine cache errors
        }
      }
      return profile;
    },
    initialData: cachedAthlete,
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
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
