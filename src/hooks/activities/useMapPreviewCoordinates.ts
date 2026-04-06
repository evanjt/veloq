import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';
import { intervalsApi } from '@/api';
import { convertLatLngTuples } from '@/lib';
import type { LatLng } from '@/lib/geo/polyline';
import type { PreviewTrack } from '@/hooks/home/useStartupData';

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
  // 2. Try engine GPS data (instant for synced activities)
  const engineResult = useMemo(() => {
    if (!hasGpsData) return null;
    if (startupTrack) return null; // startup data takes priority, skip engine call
    const engine = getRouteEngine();
    if (!engine) return null;
    const points = engine.getGpsTrack(activityId);
    if (!points || points.length === 0) return null;
    return points;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, hasGpsData, startupTrack, trigger]);

  // 3. Lightweight API fallback — only fires when neither startup nor engine has data
  const needsFetch = hasGpsData && !startupTrack && !engineResult;
  const { data: streams, isLoading: isFetching } = useQuery({
    queryKey: ['map-preview-streams', activityId],
    queryFn: () => intervalsApi.getActivityStreams(activityId, ['latlng', 'altitude']),
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10,
    enabled: needsFetch,
  });

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
  }, [startupTrack, engineResult, streams?.latlng]);

  // 5. Altitude data for terrain camera calculations
  const altitude = useMemo((): number[] | undefined => {
    if (startupTrack) return startupTrack.altitude;
    if (engineResult) {
      const elevations = engineResult.map((p) => p.elevation).filter((e): e is number => e != null);
      return elevations.length > 0 ? elevations : undefined;
    }
    if (streams?.altitude && streams.altitude.length > 0) {
      return streams.altitude as number[];
    }
    return undefined;
  }, [startupTrack, engineResult, streams?.altitude]);

  return {
    coordinates,
    altitude,
    isLoading: needsFetch && isFetching,
  };
}
