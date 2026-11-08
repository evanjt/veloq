import { useMemo } from 'react';
import { settings } from 'veloqrs';

import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { formatLocalDate } from '@/shared/format/format';

export interface HistoryRangeEstimate {
  /** Activities the widening would download that the library does not hold. */
  count: number;
  /** True when the engine only knew per-year counts and prorated them. */
  approximate: boolean;
}

/**
 * What widening the library's start from `from` back to `to` would download, as
 * the engine counts it from the remote history it knows. One read each time the
 * proposed start changes. Undefined with no proposal, or while the engine
 * cannot answer, which the caller reads as no figure to state.
 */
export function useHistoryRangeEstimate(
  from: Date | null,
  to: Date
): HistoryRangeEstimate | undefined {
  const fromDay = from ? formatLocalDate(from) : null;
  const toDay = formatLocalDate(to);
  const readEngine = useEngineRead(['activities'], [fromDay, toDay]);
  return useMemo(() => {
    if (!fromDay) return undefined;
    return readEngine(() => {
      try {
        return settings.getHistoryRangeEstimate(fromDay, toDay);
      } catch {
        // empty-on-error: undefined is "could not answer", and the sheet states no figure.
        return undefined;
      }
    });
  }, [readEngine, fromDay, toDay]);
}
