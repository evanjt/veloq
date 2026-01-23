import { useQuery } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { useAuthStore, useUnitPreference } from '@/providers';
import { useEffect } from 'react';

export function useAthlete() {
  const setAthlete = useAuthStore((state) => state.setAthlete);
  const setIntervalsPreferences = useUnitPreference((state) => state.setIntervalsPreferences);

  const query = useQuery({
    queryKey: ['athlete'],
    queryFn: () => intervalsApi.getAthlete(),
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
