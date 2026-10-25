import { useCallback, useEffect, useRef, useState } from 'react';
import { SwapOutcome, SwapState } from 'veloqrs';

import { garminSwapReplace, garminSwapState, garminSwapUndo } from '@/shared/native/garminSwap';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { queryClient } from '@/shared/query/QueryProvider';
import { queryKeys } from '@/shared/query/queryKeys';

import {
  garminSwapNotice,
  type GarminSwapAction,
  type GarminSwapNotice,
} from '../lib/garminSwapNotice';

/**
 * What the activity offers from Garmin, and the two moves the athlete can make.
 *
 * The engine compares Garmin's original with intervals.icu's file and says
 * whether to offer the swap, so this holds only its answer. A swap and an undo
 * are never started twice, and when one changed intervals.icu's file the
 * activity is read again.
 */
export function useGarminSwap(activityId: string) {
  const [state, setState] = useState<SwapState>(SwapState.Hidden);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<GarminSwapNotice | null>(null);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    try {
      return await garminSwapState(activityId);
    } catch {
      return SwapState.Hidden;
    }
  }, [activityId]);

  useEffect(() => {
    let live = true;
    refresh().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [refresh]);

  const run = useCallback(
    async (action: GarminSwapAction) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setNotice(null);
      try {
        const move = action === 'swap' ? garminSwapReplace : garminSwapUndo;
        const result = await move(activityId);
        const next = garminSwapNotice(result.outcome, action);
        setNotice(next);
        setState(await refresh());
        if (next.rereads) {
          requestSyncRefresh();
          await queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
          await queryClient.invalidateQueries({ queryKey: queryKeys.activities.infinite.all });
        }
      } catch {
        setNotice(garminSwapNotice(SwapOutcome.Failed, action));
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [activityId, refresh]
  );

  const swap = useCallback(() => {
    void run('swap');
  }, [run]);
  const undo = useCallback(() => {
    void run('undo');
  }, [run]);

  return { state, busy, notice, swap, undo };
}
