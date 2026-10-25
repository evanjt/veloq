import { useEffect, useState } from 'react';
import { settings } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import type { ActivityType } from '@/types';

function readLibrarySports(): ActivityType[] {
  return (settings.getRecordScreenData()?.librarySports ?? []) as ActivityType[];
}

/**
 * The sports the athlete's library holds, most activities first, as the engine
 * reads them. Read again when a sync lands activities.
 */
export function useLibrarySports(): ActivityType[] {
  const [sports, setSports] = useState<ActivityType[]>(readLibrarySports);

  useEffect(() => {
    const engine = getEngine();
    if (!engine) return undefined;
    const reread = () => setSports(readLibrarySports());
    reread();
    return engine.subscribe('activities', reread);
  }, []);

  return sports;
}
