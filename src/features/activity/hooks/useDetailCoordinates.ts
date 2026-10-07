/**
 * The activity detail map's line, from whichever source has it.
 *
 * The stored track is read only when the stream body is not to hand, so an
 * activity opened online pays no extra FFI call: the stream is already there
 * and the branch never runs. Offline, or on a ride never opened online, that
 * read is the whole fix, because the bulk ingest wrote the track and nothing
 * on this screen was asking for it.
 *
 * It stays its own read rather than joining the screen bundle. The track is
 * the largest thing an activity owns, this branch does not run at all when the
 * stream is to hand, and measured on the S22 in a debug Android build, everything the
 * engine answers for an activity open is 2 to 103 ms of a wait that runs to seconds. The engine's
 * own doc comment on the screen read carries the reasoning.
 */
import { useMemo } from 'react';

import { decodeCoords } from 'veloqrs';

import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { LatLng } from '@/shared/geo/polyline';

import { resolveDetailCoordinates } from '@/features/activity/lib/detailCoordinates';

export function useDetailCoordinates(
  activityId: string,
  streamLatLng: [number, number][] | undefined,
  streamsPending = false
): LatLng[] {
  // The bulk ingest announces a stored track on `activities`, the same channel
  // the feed cards redraw on, so a track landing behind an open screen brings
  // the read back.
  const readTrack = useEngineRead(['activities']);

  const gpsTrack = useMemo(() => {
    if (streamsPending || (streamLatLng && streamLatLng.length > 0)) return undefined;
    if (!activityId) return undefined;
    const encoded = readTrack((engine) => engine.getGpsTrack(activityId));
    return encoded ? decodeCoords(encoded) : undefined;
  }, [activityId, streamLatLng, streamsPending, readTrack]);

  return useMemo(
    () => resolveDetailCoordinates({ streamLatLng, gpsTrack }),
    [streamLatLng, gpsTrack]
  );
}
