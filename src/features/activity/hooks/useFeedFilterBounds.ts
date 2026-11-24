/**
 * The span of the library the feed's filter bars draw across: the first and
 * last start, and the shortest and longest distance and moving time.
 *
 * The engine answers it in one read over the stored metrics, and the activities
 * channel refreshes it when a body lands, so a sync that adds an older ride
 * widens the bars without a reload.
 */

import { useQuery } from '@tanstack/react-query';
import { activities } from 'veloqrs';

import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';

export function useFeedFilterBounds() {
  useEngineChannel('activities', queryKeys.activities.filterBounds);

  return useQuery({
    queryKey: queryKeys.activities.filterBounds,
    // An engine that is not up yet answers undefined, which the query cache refuses, so it reads null.
    queryFn: () => activities.getFeedFilterBounds() ?? null,
    staleTime: Infinity,
  });
}
