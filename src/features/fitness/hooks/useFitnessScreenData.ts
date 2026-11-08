import {
  useWellness,
  useWellnessCoverage,
  timeRangeToDays,
  type TimeRange,
} from '@/features/wellness';
import { usePaceCurve } from '@/features/stats';
import { useAuthStore } from '@/shared/app/AuthStore';
import { type PrimarySport } from '@/features/fitness/stores';
import { useZoneDistribution } from './useZoneDistribution';
import { useDailyActivityLoads } from './useDailyActivityLoads';
import { useFitnessScreenRead } from './useFitnessScreenRead';
import { useRangeCoverage } from '@/shared/native/useRangeCoverage';
import type { FitnessPlace } from '@/shared/app/fitnessEntry';
import { useValueWhileActive } from './useValueWhileActive';

interface UseFitnessScreenDataArgs {
  timeRange: TimeRange;
  sportMode: PrimarySport;
  /** The page in front. Zone, coverage and curve reads run only for the pages that show them. */
  place: FitnessPlace;
}

/**
 * Consolidates every query the FitnessScreen depends on behind a single hook.
 *
 * This intentionally preserves the original call order and the individual
 * hook options so that query keys, stale times, and `enabled` flags stay
 * byte-identical to the pre-refactor screen.
 */
export function useFitnessScreenData({ timeRange, sportMode, place }: UseFitnessScreenDataArgs) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const days = timeRangeToDays(timeRange);

  const {
    data: wellness,
    isLoading,
    isFetching,
    isPlaceholderData: wellnessHeld,
    isError,
    error,
    refetch,
  } = useWellness(timeRange);
  const wellnessCoverage = useWellnessCoverage(timeRange);

  const dailyLoads = useDailyActivityLoads(days, isAuthenticated);

  // The zone cards and their census are the Trends page's, and the threshold
  // pace curves are the Performance and Trends pages'. Those pages stay
  // mounted once visited, so each read follows the range only while its page
  // is in front and a range picked elsewhere costs none of them.
  const trendsDays = useValueWhileActive(days, place === 'trends');
  const curveDays = useValueWhileActive(days, place === 'trends' || place === 'performance');
  const trendsSport = trendsDays === undefined ? undefined : sportMode;
  const powerZones = useZoneDistribution({
    type: 'power',
    sport: trendsSport,
    days: trendsDays ?? days,
  });
  const hrZones = useZoneDistribution({ type: 'hr', sport: trendsSport, days: trendsDays ?? days });
  // The census over the period the zone cards are captioned with, which is
  // also the period the decoupling ride is picked from.
  const periodCoverage = useRangeCoverage(trendsDays ?? days, trendsDays !== undefined);

  const {
    eftpTrend,
    eftpCoverage,
    eftpChanges,
    storedRunPace,
    storedSwimPace,
    librarySport,
    fitnessDays,
    fatigueDays,
    cyclingFtp,
    runningLthr,
    decouplingBySpan,
    loadDots,
    training,
  } = useFitnessScreenRead();

  // Only the sport in view renders a threshold from these, so only that one is
  // worth a download and a `curve_bodies` row. Both were on by default, which
  // cost a cyclist up to ten curves a session, one per time range, each with a
  // pace snapshot write behind it.
  const { data: runPaceCurve } = usePaceCurve({
    sport: 'Run',
    days: curveDays ?? days,
    enabled: curveDays !== undefined && sportMode === 'Running',
  });
  const { data: swimPaceCurve } = usePaceCurve({
    sport: 'Swim',
    days: curveDays ?? days,
    enabled: curveDays !== undefined && sportMode === 'Swimming',
  });

  return {
    wellness,
    wellnessCoverage,
    wellnessHeld,
    loadDots,
    dailyLoads,
    powerZones,
    hrZones,
    periodCoverage,
    eftpTrend,
    eftpCoverage,
    eftpChanges,
    storedRunPace,
    storedSwimPace,
    librarySport,
    fitnessDays,
    fatigueDays,
    currentFTP: cyclingFtp,
    runLthr: runningLthr,
    runPaceCurve,
    swimPaceCurve,
    // The value intervals.icu stored on the ride, which is what its activity
    // screen prints, so the card and that screen cannot disagree.
    decouplingSource: decouplingBySpan.get(days) ?? null,
    // The calendar's, the weekly card's and the year comparison's part.
    training,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  };
}
