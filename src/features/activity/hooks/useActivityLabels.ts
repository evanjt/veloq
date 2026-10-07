/**
 * Name and date the activities a set of rows points at.
 *
 * A query rather than a bare read so a body landing mid-sync still fills the
 * rows in: the `activities` channel is what announces that, and it is the same
 * channel the window read this replaced was invalidated on. What it no longer
 * does is ask for the window, which on the all-time toggle was a ten-year
 * download to name at most fourteen rows.
 */
import { useQuery } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';

import { activityLabels, type ActivityLabel } from '@/features/activity/lib/activityLabels';
import { CACHE } from '@/shared/app/constants';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';

const EMPTY: Map<string, ActivityLabel> = new Map();

/** `error` is what the read threw, so a failed read is not a set of unnamed rows. */
export function useActivityLabels(ids: readonly string[]): {
  labels: Map<string, ActivityLabel>;
  error: unknown;
} {
  useEngineChannel('activities', queryKeys.activities.labels);

  const { data, error } = useQuery({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.activities.labelsFor(ids),
    queryFn: () => activityLabels(ids),
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: CACHE.SHORT,
    enabled: ids.length > 0,
  });

  return { labels: data ?? EMPTY, error };
}
