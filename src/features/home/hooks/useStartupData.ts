import { useState, useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from '@/features/routes/hooks/useEngine';
import { decodeCoords } from 'veloqrs';
import type { PreviewTrack as PreviewTrackRecord, SummaryCardData } from 'veloqrs';
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
  /** Summary card data from Rust (same record as getSummaryCardData) */
  summaryCardData: SummaryCardData;
  /** Pre-fetched GPS tracks keyed by activity ID */
  previewTracks: Map<string, PreviewTrack>;
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
 * Returns null when the engine is absent or the read fails, which the caller
 * reads as "keep what is already on screen".
 */
function fetchStartupData(previewActivityIds: string[]): StartupResult | null {
  const engine = getEngine();
  if (!engine) return null;

  try {
    const result = engine.getStartupData(buildInsightsParams(), previewActivityIds);
    if (!result) return null;

    return {
      summaryCardData: result.summaryCard,
      previewTracks: buildPreviewTracks(result.previewTracks ?? []),
    };
  } catch {
    return null;
  }
}

/**
 * One FFI call for the two things the feed paints: the summary card and the
 * GPS preview tracks for the first visible cards.
 *
 * The read runs after the interactions of the frame that scheduled it, never
 * during render, so the feed paints before the engine answers. Consecutive
 * engine events cancel each other's pending read, so a burst of them during a
 * sync costs one call rather than one each, and the last bundle stays on
 * screen until the next one arrives.
 */
export function useStartupData(previewActivityIds: string[]): {
  data: StartupResult | null;
} {
  const trigger = useEngineSubscription(['activities', 'sections']);
  const idsKey = previewActivityIds.join(',');

  // Read inside the deferred task so a changed list does not re-key the effect
  // twice for the same value.
  const idsRef = useRef(previewActivityIds);
  idsRef.current = previewActivityIds;

  const [data, setData] = useState<StartupResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      const next = fetchStartupData(idsRef.current);
      if (!cancelled && next) setData(next);
    });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [trigger, idsKey]);

  return { data };
}
