import { useCallback, useRef, useState } from 'react';
import { retryActivitySync } from '../lib/engineActivityRecord';
import { queryClient } from '@/shared/query/QueryProvider';
import { queryKeys } from '@/shared/query/queryKeys';

/**
 * Ask the engine to ready one activity again, for the Retry beside a
 * "couldn't sync" mark.
 *
 * The engine decides whether the retry cleared the fault and owns the mark, so
 * this only waits for it to finish and then re-reads what shows the mark: the
 * feed, and the caller's own read through `onSettled`. A retry already running
 * for the activity is not started twice.
 */
export function useRetryActivitySync(activityId: string, onSettled?: () => void) {
  const [retrying, setRetrying] = useState(false);
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setRetrying(true);
    try {
      await retryActivitySync(activityId);
    } catch {
      // The engine keeps the mark when the retry fails, so the read below shows it again.
    } finally {
      running.current = false;
      setRetrying(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.activities.infinite.all });
      onSettled?.();
    }
  }, [activityId, onSettled]);

  // A press handler returns nothing: a returned promise would be awaited by whoever pressed.
  const retry = useCallback(() => {
    void run();
  }, [run]);

  return { retry, retrying };
}
