import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';
import { intervalsApi } from '@/api';
import { convertLatLngTuples } from '@/lib';
import type { LatLng } from '@/lib/geo/polyline';

/**
 * Provides GPS coordinates for activity map previews.
 *
 * Engine-first: tries the Rust engine's SQLite cache (instant for synced activities).
 * Falls back to a lightweight API fetch (latlng + altitude only) for unsynced activities.
 * Once sync completes, the engine path takes over automatically via subscription.
 */
export function useMapPreviewCoordinates(
  activityId: string,
  hasGpsData: boolean
): {
  coordinates: LatLng[];
  altitude: number[] | undefined;
  isLoading: boolean;
} {
  // Re-query when engine activities change (e.g., after sync)
  const trigger = useEngineSubscription(['activities']);

  // 1. Try engine GPS data (instant for synced activities)
  const engineResult = useMemo(() => {
    if (!hasGpsData) return null;
    const engine = getRouteEngine();
    if (!engine) return null;
    const points = engine.getGpsTrack(activityId);
    if (!points || points.length === 0) return null;
    return points;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, hasGpsData, trigger]);

  // 2. Lightweight API fallback — only fires when engine has no data
  const needsFetch = hasGpsData && !engineResult;
  const { data: streams, isLoading: isFetching } = useQuery({
    queryKey: ['map-preview-streams', activityId],
    queryFn: () => intervalsApi.getActivityStreams(activityId, ['latlng', 'altitude']),
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10, // 10 min — preview data is cheap to re-fetch
    enabled: needsFetch,
  });

  // 3. Build unified coordinate array
  const coordinates = useMemo((): LatLng[] => {
    // Engine path: FfiGpsPoint[] already has {latitude, longitude} — no conversion needed
    if (engineResult) {
      return engineResult.filter((p) => !isNaN(p.latitude) && !isNaN(p.longitude));
    }
    // API fallback path: needs tuple conversion
    if (streams?.latlng && streams.latlng.length > 0) {
      return convertLatLngTuples(streams.latlng).filter(
        (c) => !isNaN(c.latitude) && !isNaN(c.longitude)
      );
    }
    return [];
  }, [engineResult, streams?.latlng]);

  // 4. Altitude data for terrain camera calculations
  const altitude = useMemo((): number[] | undefined => {
    // Engine path: extract elevation from GpsPoints
    if (engineResult) {
      const elevations = engineResult.map((p) => p.elevation).filter((e): e is number => e != null);
      return elevations.length > 0 ? elevations : undefined;
    }
    // API fallback path
    if (streams?.altitude && streams.altitude.length > 0) {
      return streams.altitude as number[];
    }
    return undefined;
  }, [engineResult, streams?.altitude]);

  return {
    coordinates,
    altitude,
    isLoading: needsFetch && isFetching,
  };
}
