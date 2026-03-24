import { useState, useEffect, useRef, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';
import type { LatLng } from '@/lib/geo/polyline';

/**
 * GPS track for an activity, pre-fetched during startup.
 */
export interface PreviewTrack {
  activityId: string;
  coordinates: LatLng[];
  altitude: number[] | undefined;
}

/**
 * Result from the single getStartupData() FFI call.
 */
export interface StartupResult {
  /** Raw insights data from Rust (same shape as getInsightsData) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insightsData: any;
  /** Raw summary card data from Rust (same shape as getSummaryCardData) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summaryCardData: any;
  /** Pre-fetched GPS tracks keyed by activity ID */
  previewTracks: Map<string, PreviewTrack>;
  /** Activity IDs with metrics already cached in engine */
  cachedMetricIds: Set<string>;
}

/**
 * Single FFI call on mount that fetches ALL data the feed screen needs:
 * insights, summary card, GPS preview tracks, and cached metric IDs.
 *
 * Replaces 20+ individual FFI calls with 1 mutex acquisition.
 */
export function useStartupData(previewActivityIds: string[]): {
  data: StartupResult | null;
  refresh: () => void;
} {
  const trigger = useEngineSubscription(['activities', 'sections']);
  const [data, setData] = useState<StartupResult | null>(null);
  const isMountedRef = useRef(true);
  const prevIdsRef = useRef('');

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchStartupData = useCallback(() => {
    const engine = getRouteEngine();
    if (!engine || !isMountedRef.current) return;

    // Compute timestamps for period ranges
    const now = new Date();
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    startOfWeek.setDate(startOfWeek.getDate() - day + (day === 0 ? -6 : 1));
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

    const fourWeeksAgo = new Date(startOfWeek);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const toTs = (d: Date) => Math.floor(d.getTime() / 1000);

    try {
      const result = engine.getStartupData(
        toTs(startOfWeek),
        toTs(now),
        toTs(startOfLastWeek),
        toTs(startOfWeek),
        toTs(fourWeeksAgo),
        toTs(todayStart),
        previewActivityIds
      );

      if (!result || !isMountedRef.current) return;

      // Build preview tracks map
      const tracks = new Map<string, PreviewTrack>();
      for (const track of result.previewTracks ?? []) {
        const coords = (track.points ?? []).filter(
          (p: { latitude: number; longitude: number }) => !isNaN(p.latitude) && !isNaN(p.longitude)
        );
        if (coords.length > 0) {
          const elevations = (track.points ?? [])
            .map((p: { elevation?: number | null }) => p.elevation)
            .filter((e: number | null | undefined): e is number => e != null);
          tracks.set(track.activityId, {
            activityId: track.activityId,
            coordinates: coords,
            altitude: elevations.length > 0 ? elevations : undefined,
          });
        }
      }

      if (isMountedRef.current) {
        setData({
          insightsData: result.insights,
          summaryCardData: result.summaryCard,
          previewTracks: tracks,
          cachedMetricIds: new Set(result.cachedMetricIds ?? []),
        });
      }
    } catch {
      // Startup data is best-effort — individual hooks will fall back
    }
  }, [previewActivityIds]);

  // Fetch on mount and when engine data changes
  useEffect(() => {
    // Skip if preview IDs haven't changed (prevents duplicate calls)
    const idsKey = previewActivityIds.join(',');
    if (idsKey === prevIdsRef.current && data) return;
    prevIdsRef.current = idsKey;

    const handle = InteractionManager.runAfterInteractions(fetchStartupData);
    return () => handle.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, fetchStartupData]);

  return { data, refresh: fetchStartupData };
}
