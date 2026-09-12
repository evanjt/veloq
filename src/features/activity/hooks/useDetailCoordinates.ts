/**
 * The activity detail map's line, from whichever source has it.
 *
 * The stored track is read only when the stream body is not to hand, so an
 * activity opened online pays no extra FFI call: the stream is already there
 * and the branch never runs. Offline, or on a ride never opened online, that
 * read is the whole fix, because the bulk ingest wrote the track and nothing
 * on this screen was asking for it.
 */
import { useMemo } from 'react';

import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { getEngine } from '@/shared/native/engine';
import type { LatLng } from '@/shared/geo/polyline';

import { resolveDetailCoordinates } from '@/features/activity/lib/detailCoordinates';

export function useDetailCoordinates(
  activityId: string,
  streamLatLng: [number, number][] | undefined
): LatLng[] {
  // The bulk ingest announces a stored track on `activities`, the same channel
  // the feed cards redraw on, so a track landing behind an open screen brings
  // the read back.
  const trigger = useEngineSubscription(['activities']);

  const gpsTrack = useMemo(() => {
    if (streamLatLng && streamLatLng.length > 0) return undefined;
    if (!activityId) return undefined;
    return getEngine()?.getGpsTrack(activityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, streamLatLng, trigger]);

  return useMemo(
    () => resolveDetailCoordinates({ streamLatLng, gpsTrack }),
    [streamLatLng, gpsTrack]
  );
}
