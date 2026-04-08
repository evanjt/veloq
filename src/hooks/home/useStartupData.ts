import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

// Compute timestamps once per session (they don't change within a single app open)
function computeTimestamps() {
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

  return {
    currentStart: toTs(startOfWeek),
    currentEnd: toTs(now),
    prevStart: toTs(startOfLastWeek),
    prevEnd: toTs(startOfWeek),
    chronicStart: toTs(fourWeeksAgo),
    todayStart: toTs(todayStart),
  };
}

function buildPreviewTracks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawTracks: any[]
): Map<string, PreviewTrack> {
  const tracks = new Map<string, PreviewTrack>();
  for (const track of rawTracks) {
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
  return tracks;
}

/**
 * Fetch startup data from the engine using current timestamps.
 * Shared by initial useMemo and manual refresh — single source of truth
 * for the computeTimestamps + getStartupData + result-building pipeline.
 */
function fetchStartupData(previewActivityIds: string[]): StartupResult | null {
  const engine = getRouteEngine();
  if (!engine) return null;

  try {
    const ts = computeTimestamps();
    const result = engine.getStartupData(
      ts.currentStart,
      ts.currentEnd,
      ts.prevStart,
      ts.prevEnd,
      ts.chronicStart,
      ts.todayStart,
      previewActivityIds
    );
    if (!result) return null;

    return {
      insightsData: result.insights,
      summaryCardData: result.summaryCard,
      previewTracks: buildPreviewTracks(result.previewTracks ?? []),
      cachedMetricIds: new Set(result.cachedMetricIds ?? []),
    };
  } catch {
    return null;
  }
}

/**
 * Single FFI call on mount that fetches ALL data the feed screen needs:
 * insights, summary card, GPS preview tracks, and cached metric IDs.
 *
 * Called synchronously in useMemo (not deferred) so data is available
 * on the very first render — eliminates duplicate getInsightsData calls.
 */
export function useStartupData(previewActivityIds: string[]): {
  data: StartupResult | null;
  refresh: () => void;
} {
  const trigger = useEngineSubscription(['activities', 'sections']);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Synchronous initial call — provides insights/summary immediately
  const initialData = useMemo(
    () => fetchStartupData(previewActivityIds),
    // Only re-run when engine data changes or preview IDs change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trigger, previewActivityIds.length > 0 ? previewActivityIds.join(',') : '']
  );

  // Track latest data (initial sync, updated when trigger changes)
  const [data, setData] = useState<StartupResult | null>(initialData);

  // Update state when initialData changes
  useEffect(() => {
    if (initialData) {
      setData(initialData);
    }
  }, [initialData]);

  const refresh = useCallback(() => {
    if (!isMountedRef.current) return;
    const result = fetchStartupData(previewActivityIds);
    if (result && isMountedRef.current) {
      setData(result);
    }
  }, [previewActivityIds]);

  return { data: data ?? initialData, refresh };
}
