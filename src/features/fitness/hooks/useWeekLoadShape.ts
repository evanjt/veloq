import { useMemo } from 'react';

import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import type { WeekShape } from '../components/WeekShapeCard';

/**
 * How the load in a window was spread, or `null` when the engine withheld a
 * reading. It withholds below four training days, which is half the weeks on a
 * real account, so `null` is the ordinary case and not a failure.
 */
export function useWeekLoadShape(startTs: number, endTs: number): WeekShape | null {
  const trigger = useEngineSubscription(['activities']);

  return useMemo(() => {
    const engine = getEngine();
    if (!engine) return null;
    try {
      return engine.getWeekLoadShape(startTs, endTs);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTs, endTs, trigger]);
}
