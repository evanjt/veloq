/**
 * The athlete profile comes from SQLite, not the API.
 *
 * Rust's sync service stores the raw intervals.icu body and the engine reads
 * it into a typed profile, so the unit and form preferences this hook lifts
 * arrive as fields rather than keys dug out of the body.
 */
import { useQuery } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';
import { useEffect } from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { getEngine } from '@/shared/native/engine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { scheduleWidgetSnapshot } from '@/features/home/lib/widgetBridge';
import type { Athlete } from '@/types';
import { TIME } from '@/shared/app/time';

function readAthlete(): Athlete | null {
  return getEngine()?.getAthleteProfile() ?? null;
}

export function useAthlete() {
  const setAthlete = useAuthStore((state) => state.setAthlete);
  // The profile outlives a plain sign-out, so the credential is what says
  // whether it may be drawn. Without this the login screen would show the
  // previous athlete's name and photo.
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const setIntervalsPreferences = useUnitPreference((state) => state.setIntervalsPreferences);
  const setFormAsPercent = useFormPreference((state) => state.setFormAsPercent);
  useEngineChannel('activities', queryKeys.profile.athlete);

  const query = useQuery({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.profile.athlete,
    queryFn: readAthlete,
    enabled: isAuthenticated,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: TIME.DAY,
  });

  useEffect(() => {
    if (query.data) {
      setAthlete(query.data);

      const { measurementPreference, formAsPercent } = query.data;
      if (measurementPreference != null) {
        setIntervalsPreferences({
          measurementPreference: measurementPreference === 'feet' ? 'feet' : 'meters',
        });
      }
      // What the form number on every screen means, absolute TSB or a share of
      // fitness. Absent on a record from before the setting existed, which
      // reads as absolute.
      if (formAsPercent != null) {
        // The widget colours from zones stored in its snapshot, so a flag that
        // moved reaches it only when the snapshot is rebuilt. Rebuilding on
        // the data alone left it a sync behind.
        const moved = setFormAsPercent(formAsPercent);
        if (moved) scheduleWidgetSnapshot();
      }
    }
  }, [query.data, setAthlete, setIntervalsPreferences, setFormAsPercent]);

  return query;
}
