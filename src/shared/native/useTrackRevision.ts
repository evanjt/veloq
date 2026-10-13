/**
 * How many times the engine has announced replacing one activity's track
 * while the caller has been mounted.
 *
 * A map source that names the track by URL is not fetched again while the URL
 * stays the same, so whatever replaces the stored track has to move it. A
 * re-ingest announces the ids it replaced on `gpsTracksMutated`; a track
 * arriving for the first time is not a replacement and does not count.
 *
 * Another activity starts at zero: a page that has not drawn its line has
 * nothing stale to refetch.
 */
import { useEffect, useState } from 'react';

import { useEngineReady } from './useEngineReady';

export function useTrackRevision(activityId: string | null | undefined): number {
  const engine = useEngineReady();
  const [count, setCount] = useState<{ id: string | null | undefined; revision: number }>({
    id: activityId,
    revision: 0,
  });

  useEffect(() => {
    if (!engine || !activityId) return undefined;
    return engine.subscribe('gpsTracksMutated', (payload) => {
      if (!payload || !('activityIds' in payload)) return;
      if (!payload.activityIds.includes(activityId)) return;
      setCount((prior) => ({
        id: activityId,
        revision: (prior.id === activityId ? prior.revision : 0) + 1,
      }));
    });
  }, [engine, activityId]);

  return count.id === activityId ? count.revision : 0;
}
