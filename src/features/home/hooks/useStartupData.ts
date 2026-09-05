import { useState, useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from '@/features/routes/hooks/useEngine';
import { decodeCoords, SyncState } from 'veloqrs';
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

/** Whether the engine says a sync is running right now. */
function syncInFlight(): boolean {
  try {
    return getEngine()?.getSyncStatus()?.state === SyncState.Syncing;
  } catch {
    return false;
  }
}

/**
 * A counter that advances when the engine says a sync reached a terminal
 * state. The channel carries no payload, so the value is only a signal.
 */
function useSyncSettled(): number {
  const [settled, setSettled] = useState(0);

  useEffect(() => {
    const bump = () => setSettled((n) => n + 1);
    let unsubscribe = getEngine()?.subscribe('syncSettled', bump);
    if (unsubscribe) return unsubscribe;
    // The engine can arrive after this screen mounts, and a launch sync
    // settles once. Missing it would leave the feed on its first read.
    const interval = setInterval(() => {
      const engine = getEngine();
      if (!engine) return;
      unsubscribe = engine.subscribe('syncSettled', bump);
      clearInterval(interval);
    }, 200);
    return () => {
      clearInterval(interval);
      unsubscribe?.();
    };
  }, []);

  return settled;
}

/**
 * One FFI call for the two things the feed paints: the summary card and the
 * GPS preview tracks for the first visible cards.
 *
 * The read runs after the interactions of the frame that scheduled it, never
 * during render, so the feed paints before the engine answers.
 *
 * A sync announces `activities` once per page it lands, and each announcement
 * used to cost a whole bundle: 70 to 85 ms on the JS thread under the engine
 * write lock, five times in the first four and a half seconds of a launch. So
 * while a sync is in flight the bundle is read once, the rest are held, and the
 * sync settling spends the one read that covers all of them. Outside a sync
 * every announcement reads, because then there is nothing else to wait for.
 */
export function useStartupData(previewActivityIds: string[]): {
  data: StartupResult | null;
} {
  const trigger = useEngineSubscription(['activities', 'sections']);
  const settled = useSyncSettled();
  const idsKey = previewActivityIds.join(',');

  // Read inside the deferred task so a changed list does not re-key the effect
  // twice for the same value.
  const idsRef = useRef(previewActivityIds);
  idsRef.current = previewActivityIds;

  // Whether this sync has already been read for, and whether anything was held
  // back while it ran. Refs, because neither may re-render on its own.
  const readThisSync = useRef(false);
  const held = useRef(false);
  // The settle effect runs once on mount before any sync has settled, and its
  // reset would spend a second read on the announcement that follows.
  const settleSeen = useRef(false);

  const [data, setData] = useState<StartupResult | null>(null);

  useEffect(() => {
    if (syncInFlight()) {
      if (readThisSync.current) {
        held.current = true;
        return;
      }
      readThisSync.current = true;
    } else {
      readThisSync.current = false;
    }

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

  useEffect(() => {
    if (!settleSeen.current) {
      settleSeen.current = true;
      return;
    }
    readThisSync.current = false;
    // A settle with nothing held back has nothing new to report: the last read
    // already saw whatever the sync landed.
    if (!held.current) return;
    held.current = false;

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
  }, [settled]);

  return { data };
}
