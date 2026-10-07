import { useMemo } from 'react';

import { readLibraryCount } from './libraryCount';
import { useEngineRead } from './useEngineSubscription';

/**
 * How many activities the library holds, re-read whenever a sync changes them.
 *
 * A memo keyed on nothing would show the count as it stood when the screen
 * opened, which is what the backup row used to show.
 */
export function useActivityCount(): number {
  const readActivities = useEngineRead(['activities']);

  return useMemo(() => readActivities((engine) => readLibraryCount(engine)) ?? 0, [readActivities]);
}
