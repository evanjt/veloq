import { useMemo } from 'react';

import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { ledgerChipIds } from '../lib/sectionLedger';
import { MAX_CHIPS } from '../components/section/SectionHistoryPanel';
import type { SectionHistoryEvent } from './useSectionLedger';

/**
 * Display names for the activities the history panel draws chips for.
 *
 * One batched read for the whole panel. A read per chip would be a blocking
 * FFI hop each on a screen where a transition is already running, and the
 * panel can draw six per change across every change a section has.
 *
 * Ids the engine has no name for are simply absent, which is what the chip's
 * fallback to the id keys on. Keyed on the `activities` channel as well as the
 * history, because a traversal can be on the ledger before the sync that
 * carries its name has landed, and nothing else would re-read.
 */
export function useLedgerActivityNames(history: SectionHistoryEvent[]): Record<string, string> {
  const readNames = useEngineRead(['activities']);

  return useMemo(() => {
    const ids = ledgerChipIds(history, MAX_CHIPS);
    if (ids.length === 0) return {};

    return (
      readNames((engine) => {
        if (!engine.getActivityNames) return {};

        const names: Record<string, string> = {};
        for (const row of engine.getActivityNames(ids)) names[row.activityId] = row.name;
        return names;
      }) ?? {}
    );
  }, [history, readNames]);
}
