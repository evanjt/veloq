import { useMemo } from 'react';

import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { formatLocalDate } from '@/shared/format/format';
import type { EftpChange } from '../lib/eftpChanges';

/**
 * The activities that moved the athlete's accepted eFTP, oldest first.
 *
 * The sync stores the marker as it stores the metrics, so this is one engine
 * read rather than a pass over every parsed activity body in the window. Empty
 * until the first sync after the upgrade that added the table.
 */
export function useEftpChanges(): EftpChange[] {
  const readActivities = useEngineRead(['activities']);

  return useMemo(() => {
    try {
      const changes = readActivities((engine) => engine.getEftpChanges()) ?? [];
      return changes.map((change) => ({
        date: formatLocalDate(new Date(Number(change.date) * 1000)),
        eftp: change.eftp,
        delta: change.delta,
        activityId: change.activityId,
        activityName: change.activityName,
      }));
    } catch {
      return [];
    }
  }, [readActivities]);
}
