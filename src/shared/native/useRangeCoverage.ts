import { useMemo } from 'react';
import { RangeCoverage } from 'veloqrs';

import { formatLocalDate } from '@/shared/format/format';

import { useEngineRead } from './useEngineSubscription';

/**
 * Whether a trailing window of days holds nothing, owes a download, or is fully
 * local, as the engine's census answers it.
 *
 * A chart that draws an empty axis cannot say why on its own. Every reader
 * collapsed the engine's `null` into an empty value before the chart saw it, so
 * a month the athlete rested and a month the device never pulled both read "no
 * data", and offline the second is the common one.
 *
 * `NotFetched` is the answer to every kind of ignorance: no engine yet, no
 * credential, no census pulled. `Empty` is a claim about the account and is only
 * made when the census has been pulled and names nothing inside the window.
 *
 * Read through `useEngineRead` on the `activities` channel, because a window
 * sync landing is exactly what turns `NotFetched` into one of the other two.
 */
export function useRangeCoverage(days: number, enabled = true): RangeCoverage {
  const readEngine = useEngineRead(['activities']);

  return useMemo(() => {
    if (!enabled) return RangeCoverage.NotFetched;
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - days);
    try {
      return (
        readEngine((engine) =>
          engine.rangeCoverage(formatLocalDate(start), formatLocalDate(today))
        ) ?? RangeCoverage.NotFetched
      );
    } catch {
      // A throw is the engine refusing the read, which is ignorance too.
      return RangeCoverage.NotFetched;
    }
  }, [days, enabled, readEngine]);
}
