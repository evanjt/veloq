import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useForeground } from '@/shared/app/useRetryTriggers';
import { getEngine } from '@/shared/native/engine';
import { queryKeys } from '@/shared/query/queryKeys';

/**
 * Take whatever a push handler wrote while the app was away.
 *
 * On iOS the notification service extension is a second process against the
 * same App Group database. It fetches a body, stores a track, writes the
 * metrics row and indexes the activity against the catalogue, and a foreground
 * engine that stayed alive through all of it holds tiers that predate every one
 * of those rows. Nothing else notices: the rows are committed, the engine
 * simply never re-reads them, and the screens show a section count and an
 * activity list that are wrong with nothing to say so.
 *
 * `takeExternalWrites` compares a token the handler bumped against the one the
 * tiers speak for, so the common resume costs one `SELECT` and only a resume
 * that missed a push pays the reload. On Android the handler shares the process
 * and the same engine, so it notes its own write and this answers false.
 *
 * The queries are invalidated only when the tiers actually moved. The set is
 * what a push can change: the activity it stored, the sections it matched
 * against and the athlete totals that count both.
 */
export function usePushedWritesOnForeground(): void {
  const queryClient = useQueryClient();

  const take = useCallback(() => {
    if (getEngine()?.takeExternalWrites?.() !== true) return;

    queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.activities.infinite.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.athleteSummary.all });
  }, [queryClient]);

  useForeground(take);
}
