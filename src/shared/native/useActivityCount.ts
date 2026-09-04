import { useMemo } from 'react';

import { getEngine } from './engine';
import { useEngineSubscription } from './useEngineSubscription';

/**
 * How many activities the engine holds, re-read whenever a sync changes them.
 *
 * A memo keyed on nothing would show the count as it stood when the screen
 * opened, which is what `B210` found on the backup row.
 */
export function useActivityCount(): number {
  const trigger = useEngineSubscription(['activities']);

  return useMemo(() => getEngine()?.getActivityCount() ?? 0, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps
}
