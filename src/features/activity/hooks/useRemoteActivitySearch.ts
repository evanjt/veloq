import { useCallback, useState } from 'react';
import { FfiRemoteSearchStatus, type FfiRemoteActivity } from 'veloqrs';

import { searchRemoteActivities } from '@/shared/native/remoteActivitySearch';
import type { FeedFilter } from '../lib/feedFilter';
import { remoteSearchKey, remoteSearchQuery } from '../lib/remoteSearch';

export type RemoteSearchPhase = 'idle' | 'loading' | 'done' | 'failed' | 'unavailable';

interface Answer {
  key: string;
  phase: Exclude<RemoteSearchPhase, 'idle'>;
  rows: FfiRemoteActivity[];
  capped: boolean;
}

const NO_ROWS: FfiRemoteActivity[] = [];

/**
 * The search of the athlete's account under the feed's filter, run when the
 * athlete asks and never before. An answer belongs to the filter it was asked
 * under: changing the filter returns to `idle`, and an answer that lands after
 * the filter moved is not shown.
 */
export function useRemoteActivitySearch(filter: FeedFilter) {
  const key = remoteSearchKey(filter);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const current = answer?.key === key ? answer : null;

  const run = useCallback(async () => {
    setAnswer({ key, phase: 'loading', rows: NO_ROWS, capped: false });
    const result = await searchRemoteActivities(remoteSearchQuery(filter));
    const phase =
      result.status === FfiRemoteSearchStatus.Found
        ? 'done'
        : result.status === FfiRemoteSearchStatus.Failed
          ? 'failed'
          : 'unavailable';
    setAnswer((previous) =>
      previous?.key === key ? { key, phase, rows: result.rows, capped: result.capped } : previous
    );
  }, [key, filter]);

  return {
    phase: (current?.phase ?? 'idle') as RemoteSearchPhase,
    rows: current?.rows ?? NO_ROWS,
    capped: current?.capped ?? false,
    run,
  };
}
