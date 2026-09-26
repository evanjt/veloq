import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getEngine } from '@/shared/native/engine';
import { useEngineReady } from '@/shared/native/useEngineReady';
import {
  PREVIEW_STREAM_TYPES,
  readStreams,
  requestStreams,
} from '@/features/activity/lib/engineStreams';
import { useEngineBody } from '@/shared/native/engineBodies';
import { queryKeys } from '@/shared/query/queryKeys';
import { CACHE } from '@/shared/app/constants';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { decodeCoords } from 'veloqrs';
import { convertLatLngTuples } from '@/shared/geo/polyline';
import type { LatLng } from '@/shared/geo/polyline';
import type { ActivityStreams } from '@/types';
import type { PreviewTrack } from '@/features/home/hooks/useStartupData';

/**
 * Drop the preview line of every activity whose stored track was replaced.
 *
 * Mounted once for the life of the app rather than per card: the announcement
 * names the ids, and a card that is not on screen has no query to invalidate.
 * This is what lets the read above be keyed on the activity alone.
 */
export function useMutatedPreviewTracks(): void {
  const queryClient = useQueryClient();
  const engine = useEngineReady();

  useEffect(() => {
    if (!engine) return undefined;
    return engine.subscribe('gpsTracksMutated', (payload) => {
      if (!payload || !('activityIds' in payload)) return;
      for (const id of payload.activityIds) {
        queryClient.invalidateQueries({ queryKey: queryKeys.activities.previewTrack(id) });
      }
    });
  }, [engine, queryClient]);
}

/**
 * Re-read the preview line of an activity whose track has just been stored.
 *
 * The twin of the hook above, and mounted beside it for the same reason: the
 * announcement names one id and a card that is not on screen has no query to
 * invalidate. The two channels are not the same event. `gpsTracksMutated`
 * names tracks that were *replaced*, which is a re-ingest; `gpsTrackStored`
 * names one arriving for the first time, which is the bulk GPS run filling a
 * fresh install. Only the first had a subscriber, so on a first launch the
 * head's tracks landed within seconds and no card asked for a render until its
 * own duplicate body arrived or the sync moved on.
 */
export function useStoredPreviewTracks(): void {
  const queryClient = useQueryClient();
  const engine = useEngineReady();

  useEffect(() => {
    if (!engine) return undefined;
    return engine.subscribe('gpsTrackStored', (payload) => {
      if (!payload || !('activityId' in payload)) return;
      const { activityId } = payload as { activityId?: unknown };
      if (typeof activityId !== 'string' || !activityId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.previewTrack(activityId) });
    });
  }, [engine, queryClient]);
}

/**
 * Provides GPS coordinates for activity map previews.
 *
 * Priority: startup pre-fetched data → engine SQLite → lightweight API fallback.
 * On warm startup, the startup data provides tracks instantly (no FFI or network).
 */
export function useMapPreviewCoordinates(
  activityId: string,
  hasGpsData: boolean,
  startupTrack?: PreviewTrack | undefined
): {
  coordinates: LatLng[];
  altitude: number[] | undefined;
  isLoading: boolean;
} {
  // 1. Use startup pre-fetched data if available (zero cost)
  // 2. Try the engine's preview line (instant for synced activities)
  //
  // The preview line is the cached signature, about a hundred points, and the
  // same one the startup bundle hands the first cards. Reading the stored
  // track here instead decoded the whole blob and boxed one record per point
  // for a thumbnail that draws at a hundred.
  //
  // Keyed on the activity rather than on the coarse `activities` trigger,
  // which every card followed: a sync settling re-read and re-boxed the track
  // of every card on screen and invalidated the camera memos under it. A
  // preview line does move for an activity that already has one, because a
  // re-ingest with different points recomputes the signature, so the engine
  // names those ids and `useMutatedPreviewTracks` drops exactly their keys.
  const { data: previewPoints } = useQuery({
    queryKey: queryKeys.activities.previewTrack(activityId),
    queryFn: () => {
      const engine = getEngine();
      const track = engine?.getPreviewTrack(activityId);
      if (!track) return null;
      const points = decodeCoords(track.encodedCoords);
      return points.length > 0 ? points : null;
    },
    enabled: hasGpsData && !startupTrack && !!activityId,
    staleTime: Infinity,
    gcTime: CACHE.HOUR,
  });
  const engineResult = previewPoints ?? null;

  // 3. Lightweight API fallback - only fires when neither startup nor engine has data
  const needsFetch = hasGpsData && !startupTrack && !engineResult;

  // The bulk GPS run fetches the same `latlng` and `altitude` off the same
  // endpoint for the ids it holds, so a card asking for its own while the run
  // is on it is the second download of one track, on the Interactive lane the
  // rest of the app's taps use. The track's own arrival fills the card
  // instead, through `useStoredPreviewTracks` above. The set is empty whenever
  // no run is going, so this costs a card outside one nothing.
  const bulkRunHasIt = useSyncDateRange((s) => s.gpsSyncPendingIds.has(activityId));
  const { data: streams, isLoading: isFetching } = useQuery<ActivityStreams | null>({
    queryKey: queryKeys.activities.mapPreview(activityId),
    queryFn: () => readStreams(activityId, PREVIEW_STREAM_TYPES),
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10,
    enabled: needsFetch,
  });

  // Presence comes from the query rather than a second read in the render
  // body: this hook runs once per feed card, so the probe was a body read and
  // a parse per card per render for a boolean the query already has.
  useEngineBody(
    streams != null,
    () => requestStreams(activityId, PREVIEW_STREAM_TYPES),
    queryKeys.activities.mapPreview(activityId),
    needsFetch && streams !== undefined && !bulkRunHasIt
  );

  // 4. Build unified coordinate array (priority: startup → engine → API)
  const coordinates = useMemo((): LatLng[] => {
    if (startupTrack) return startupTrack.coordinates;
    if (engineResult) {
      return engineResult.filter((p) => !isNaN(p.latitude) && !isNaN(p.longitude));
    }
    if (streams?.latlng && streams.latlng.length > 0) {
      return convertLatLngTuples(streams.latlng).filter(
        (c) => !isNaN(c.latitude) && !isNaN(c.longitude)
      );
    }
    return [];
  }, [startupTrack, engineResult, streams]);

  // 5. Altitude data for terrain camera calculations
  const altitude = useMemo((): number[] | undefined => {
    if (startupTrack) return startupTrack.altitude;
    if (engineResult) {
      const elevations = engineResult
        .map((p) => p.elevation)
        .filter((e): e is number => e !== undefined);
      return elevations.length > 0 ? elevations : undefined;
    }
    if (streams?.altitude && streams.altitude.length > 0) {
      return streams.altitude as number[];
    }
    return undefined;
  }, [startupTrack, engineResult, streams]);

  return {
    coordinates,
    altitude,
    isLoading: needsFetch && isFetching,
  };
}
