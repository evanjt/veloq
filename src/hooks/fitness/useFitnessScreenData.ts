import { useMemo } from 'react';
import { useWellness, timeRangeToDays, type TimeRange } from './useWellness';
import { useZoneDistribution } from './useZoneDistribution';
import { useActivities, useActivityStreams, useEFTPHistory, getLatestFTP } from '../activities';
import { useSportSettings, getSettingsForSport } from '../useSportSettings';
import { usePaceCurve, useSeasonBests } from '../charts';
import { useAuthStore, type PrimarySport } from '@/providers';

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
    includeStats: true,
    enabled: isAuthenticated,
  });

  const powerZones = useZoneDistribution({ type: 'power', sport: sportMode });
  const hrZones = useZoneDistribution({ type: 'hr', sport: sportMode });

  const eftpHistory = useEFTPHistory(activities);
  const currentFTP = useMemo(() => getLatestFTP(activities), [activities]);

  const { data: sportSettings } = useSportSettings();
  const runSettings = getSettingsForSport(sportSettings, 'Run');

  const { data: runPaceCurve } = usePaceCurve({ sport: 'Run', days });
  const { data: swimPaceCurve } = usePaceCurve({ sport: 'Swim', days });

  const {
    efforts: bestsEfforts,
    isLoading: loadingBests,
    headerSummary: bestsHeader,
  } = useSeasonBests({ sport: sportMode, days });

  const decouplingActivity = useMemo(() => {
    if (!activities) return null;
    return (
      activities.find(
        (a) =>
          (a.type === 'Ride' || a.type === 'VirtualRide') &&
          (a.icu_average_watts || a.average_watts) &&
          (a.average_heartrate || a.icu_average_hr) &&
          a.moving_time >= 30 * 60
      ) || null
    );
  }, [activities]);

  const { data: decouplingStreams, isLoading: loadingStreams } = useActivityStreams(
    decouplingActivity?.id || ''
  );

  return {
    wellness,
    activities,
    powerZones,
    hrZones,
    eftpHistory,
    currentFTP,
    runSettings,
    runPaceCurve,
    swimPaceCurve,
    bestsEfforts,
    loadingActivities,
    loadingBests,
    bestsHeader,
    decouplingActivity,
    decouplingStreams,
    loadingStreams,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  };
}
