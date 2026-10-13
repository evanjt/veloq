/**
 * The engine's URL for one activity's stored track, or null when it holds none.
 *
 * A map source names this URL rather than carrying the line: the page asks for
 * it on its own origin and the engine answers the GeoJSON, so a long ride never
 * crosses the bridge as text. Null is an activity with no stored track, whose
 * line the caller sends inline.
 *
 * Whether the engine holds the track is the caller's to say, from the screen
 * read it already has: the detail read carries it, and every activity the
 * regional map lists is a catalogue row, which the engine writes together with
 * its track.
 */
import { useMemo } from 'react';

import { useTrackRevision } from '@/shared/native/useTrackRevision';

import { nativeGeoUrl } from '../lib/tileTransport';

export function useStoredTrackUrl(
  activityId: string | null | undefined,
  held: boolean
): string | null {
  const revision = useTrackRevision(held ? activityId : null);
  return useMemo(
    () => (held && activityId ? nativeGeoUrl('track', activityId, revision) : null),
    [held, activityId, revision]
  );
}
