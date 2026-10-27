import { useCallback, useEffect, useRef, useState } from 'react';
import { SwapOutcome, SwapState } from 'veloqrs';

import {
  garminSwapCheck,
  garminSwapReplace,
  garminSwapState,
  garminSwapUndo,
} from '@/shared/native/garminSwap';
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
 * Opening the activity downloads nothing: the engine answers from what the
 * phone holds, and compares Garmin's original with intervals.icu's file only
 * when the athlete asks to check. This holds only its answer. A check, a swap
 * and an undo are never started twice, and when one changed intervals.icu's file the
 * activity is read again. A caller that already knows the state passes it and
 * the hook does not ask for it.
 */
export function useGarminSwap(activityId: string, knownState?: SwapState) {
  const [state, setState] = useState<SwapState>(knownState ?? SwapState.Hidden);
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
    // A feed card already holds the engine's verdict, so it asks nothing of intervals.icu.
    let live = true;
    if (knownState === undefined) {
      refresh().then((next) => {
        if (live) setState(next);
      });
    }
    return () => {
      live = false;
    };
  }, [refresh, knownState]);

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

  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNotice(null);
    try {
      setState(await garminSwapCheck(activityId));
    } catch {
      setNotice(garminSwapNotice(SwapOutcome.Failed, 'swap'));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [activityId]);

  const swap = useCallback(() => {
    void run('swap');
  }, [run]);
  const undo = useCallback(() => {
    void run('undo');
  }, [run]);

  return { state, busy, notice, check, swap, undo };
}
