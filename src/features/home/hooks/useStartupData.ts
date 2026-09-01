import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from '@/features/routes/hooks/useEngine';
import { decodeCoords } from 'veloqrs';
import type { InsightsData, PreviewTrack as PreviewTrackRecord, SummaryCardData } from 'veloqrs';
import { buildInsightsParams } from '@/features/insights/lib/insightsParams';
import type { LatLng } from '@/shared/geo/polyline';

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
  /** Insights data from Rust (same record as getInsightsData) */
  insightsData: InsightsData;
  /** Summary card data from Rust (same record as getSummaryCardData) */
  summaryCardData: SummaryCardData;
  /** Pre-fetched GPS tracks keyed by activity ID */
  previewTracks: Map<string, PreviewTrack>;
  /** Activity IDs with metrics already cached in engine */
  cachedMetricIds: Set<string>;
}

function buildPreviewTracks(rawTracks: readonly PreviewTrackRecord[]): Map<string, PreviewTrack> {
  const tracks = new Map<string, PreviewTrack>();
  for (const track of rawTracks) {
    const decoded = decodeCoords(track.encodedCoords);
    const coords = decoded.filter((p) => !isNaN(p.latitude) && !isNaN(p.longitude));
    if (coords.length > 0) {
      tracks.set(track.activityId, {
        activityId: track.activityId,
        coordinates: coords,
        altitude: undefined, // preview cards render position only
      });
    }
  }
  return tracks;
}

/**
 * Fetch startup data from the engine using current timestamps.
 * Shared by initial useMemo and manual refresh - single source of truth
 * for the computeTimestamps + getStartupData + result-building pipeline.
 */
function fetchStartupData(previewActivityIds: string[]): StartupResult | null {
  const engine = getEngine();
  if (!engine) return null;

  try {
    const result = engine.getStartupData(buildInsightsParams(), previewActivityIds);
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
 * on the very first render - eliminates duplicate getInsightsData calls.
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

  // Synchronous initial call - provides insights/summary immediately
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
