import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from '@/features/routes/hooks/useEngine';
import {
  PREVIEW_STREAM_TYPES,
  readStreams,
  requestStreams,
} from '@/features/activity/lib/engineStreams';
import { useEngineBody } from '@/shared/native/engineBodies';
import { queryKeys } from '@/shared/query/queryKeys';
import { decodeCoords } from 'veloqrs';
import { convertLatLngTuples } from '@/shared/geo/polyline';
import type { LatLng } from '@/shared/geo/polyline';
import type { ActivityStreams } from '@/types';
import type { PreviewTrack } from '@/features/home/hooks/useStartupData';

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
  // Re-query when engine activities change (e.g., after sync)
  const trigger = useEngineSubscription(['activities']);

  // 1. Use startup pre-fetched data if available (zero cost)
  // 2. Try the engine's preview line (instant for synced activities)
  //
  // The preview line is the cached signature, about a hundred points, and the
  // same one the startup bundle hands the first cards. Reading the stored
  // track here instead decoded the whole blob and boxed one record per point
  // for a thumbnail that draws at a hundred.
  const engineResult = useMemo(() => {
    if (!hasGpsData) return null;
    if (startupTrack) return null; // startup data takes priority, skip engine call
    const engine = getEngine();
    if (!engine) return null;
    const track = engine.getPreviewTrack(activityId);
    if (!track) return null;
    const points = decodeCoords(track.encodedCoords);
    return points.length > 0 ? points : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, hasGpsData, startupTrack, trigger]);

  // 3. Lightweight API fallback - only fires when neither startup nor engine has data
  const needsFetch = hasGpsData && !startupTrack && !engineResult;
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
    needsFetch && streams !== undefined
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
