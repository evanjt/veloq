import { useMemo } from 'react';

import { useWellness, timeRangeToDays, type TimeRange } from '@/features/wellness';
import { decouplingSource, useActivities, getLatestFTP } from '@/features/activity';
import { useSportSettings, getSettingsForSport } from '@/shared/app/useSportSettings';
import { usePaceCurve, useSeasonBests } from '@/features/stats';
import { useAuthStore } from '@/shared/app/AuthStore';
import { type PrimarySport } from '@/features/fitness/stores';
import { useZoneDistribution } from './useZoneDistribution';
import { useDailyActivityLoads } from './useDailyActivityLoads';
import { useFitnessScreenRead } from './useFitnessScreenRead';
import { useRangeCoverage } from '@/shared/native/useRangeCoverage';

interface UseFitnessScreenDataArgs {
  timeRange: TimeRange;
  sportMode: PrimarySport;
}

/**
 * Consolidates every query the FitnessScreen depends on behind a single hook.
 *
 * This intentionally preserves the original call order and the individual
 * hook options so that query keys, stale times, and `enabled` flags stay
 * byte-identical to the pre-refactor screen.
 */
export function useFitnessScreenData({ timeRange, sportMode }: UseFitnessScreenDataArgs) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const days = timeRangeToDays(timeRange);

  const { data: wellness, isLoading, isFetching, isError, error, refetch } = useWellness(timeRange);

  const { data: activities, isLoading: loadingActivities } = useActivities({
    days,
    enabled: isAuthenticated,
  });

  const dailyLoads = useDailyActivityLoads(days, isAuthenticated);

  const powerZones = useZoneDistribution({ type: 'power', sport: sportMode, days });
  const hrZones = useZoneDistribution({ type: 'hr', sport: sportMode, days });
  // The census over the period the zone cards are captioned with.
  const zoneCoverage = useRangeCoverage(days);

  const { eftpTrend, eftpChanges, storedRunPace, storedSwimPace } = useFitnessScreenRead();

  const { data: sportSettings } = useSportSettings();
  const cyclingSettings = getSettingsForSport(sportSettings, 'Ride');
  const currentFTP = useMemo(
    () => cyclingSettings?.ftp ?? getLatestFTP(activities),
    [cyclingSettings, activities]
  );
  const runSettings = getSettingsForSport(sportSettings, 'Run');

  // Only the sport in view renders a threshold from these, so only that one is
  // worth a download and a `curve_bodies` row. Both were on by default, which
  // cost a cyclist up to ten curves a session, one per time range, each with a
  // pace snapshot write behind it.
  const { data: runPaceCurve } = usePaceCurve({
    sport: 'Run',
    days,
    enabled: sportMode === 'Running',
  });
  const { data: swimPaceCurve } = usePaceCurve({
    sport: 'Swim',
    days,
    enabled: sportMode === 'Swimming',
  });

  const {
    efforts: bestsEfforts,
    climbing: bestsClimbing,
    climbingStatus: bestsClimbingStatus,
    isLoading: loadingBests,
    headerSummary: bestsHeader,
  } = useSeasonBests({ sport: sportMode, days });

  // The value intervals.icu stored on the ride, which is what its activity
  // screen prints, so the card and that screen cannot disagree.
  const decoupling = useMemo(() => decouplingSource(activities), [activities]);

  return {
    wellness,
    activities,
    dailyLoads,
    powerZones,
    hrZones,
    zoneCoverage,
    eftpTrend,
    eftpChanges,
    storedRunPace,
    storedSwimPace,
    currentFTP,
    runSettings,
    runPaceCurve,
    swimPaceCurve,
    bestsEfforts,
    bestsClimbing,
    bestsClimbingStatus,
    loadingActivities,
    loadingBests,
    bestsHeader,
    decouplingSource: decoupling,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  };
}
