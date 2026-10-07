import { useQuery } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';
import { getEngine } from '@/shared/native/engine';
import { useEngineBody } from '@/shared/native/engineBodies';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';
import type { BestEffortsData } from 'veloqrs';

/** The sports the Best Efforts read carries, by the engine's name for each. */
export type BestEffortsSport = 'Ride' | 'Run' | 'Swim';

/**
 * The Best Efforts screen read over the last `days` days, or all time at 0.
 *
 * The engine picks every best out of the stored curves and climb rows, so
 * this only asks for a curve the read reports as never fetched, and only for
 * the sports in `shown`: a curve nobody looks at is not worth a download.
 */
export function useBestEfforts(days: number, shown: readonly BestEffortsSport[]) {
  const queryKey = queryKeys.charts.bestEfforts.byDays(days);
  // A sync landing new activities moves the climb rows.
  useEngineChannel('activities', queryKeys.charts.bestEfforts.all);

  const query = useQuery<BestEffortsData | null>({
    ...LOCAL_READ_QUERY,
    queryKey,
    queryFn: () => getEngine()?.getBestEffortsData(days) ?? null,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
  });

  const fetched = (sport: BestEffortsSport) =>
    query.data?.sports.find((s) => s.sport === sport)?.fetched ?? false;
  const asks = (sport: BestEffortsSport) => shown.includes(sport) && query.data !== undefined;

  // One wait per curve, so each is asked for and announced on its own.
  useEngineBody(
    fetched('Ride'),
    () => getEngine()?.syncPowerCurve('Ride', days),
    queryKey,
    asks('Ride')
  );
  useEngineBody(
    fetched('Run'),
    () => getEngine()?.syncPaceCurve('Run', days, false),
    queryKey,
    asks('Run')
  );
  useEngineBody(
    fetched('Swim'),
    () => getEngine()?.syncPaceCurve('Swim', days, false),
    queryKey,
    asks('Swim')
  );

  return query;
}
