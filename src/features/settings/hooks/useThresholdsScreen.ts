/**
 * The athlete's threshold figures with their sources, read from the engine when
 * the screen opens and again after every write.
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';
import { queryKeys } from '@/shared/query/queryKeys';
import { settings, type FfiThresholdField, type FfiThresholdsScreenData } from 'veloqrs';

export function useThresholdsScreen() {
  const client = useQueryClient();
  const query = useQuery({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.thresholdsScreen,
    queryFn: (): FfiThresholdsScreenData | null => settings.getThresholdsScreenData() ?? null,
    staleTime: 0,
    gcTime: 0,
  });

  /** Sets a figure, or clears it with `null`. Throws when the engine refuses the value. */
  const setFigure = useCallback(
    async (sport: string, field: FfiThresholdField, value: number | null) => {
      settings.setThresholdOverride(sport, field, value);
      await client.invalidateQueries({ queryKey: queryKeys.thresholdsScreen });
    },
    [client]
  );

  return { data: query.data, failed: query.isError, setFigure };
}
