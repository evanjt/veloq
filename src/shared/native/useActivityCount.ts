import { useMemo } from 'react';

import { useEngineRead } from './useEngineSubscription';

/**
 * How many activities the engine holds, re-read whenever a sync changes them.
 *
 * A memo keyed on nothing would show the count as it stood when the screen
 * opened, which is what the backup row used to show.
 */
export function useActivityCount(): number {
  const readActivities = useEngineRead(['activities']);

  return useMemo(
    () => readActivities((engine) => engine.getActivityCount()) ?? 0,
    [readActivities]
  );
}
