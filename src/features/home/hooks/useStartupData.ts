import { useState, useEffect, useRef, useCallback } from 'react';
import { runWhenIdle } from '@/shared/async/runWhenIdle';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { decodeCoords, SyncState } from 'veloqrs';
import type {
  PreviewTrack as PreviewTrackRecord,
  SummaryCardData,
  WellnessSparklines,
} from 'veloqrs';
import { buildInsightsParams } from '@/features/insights';
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
  /** The card's sparklines, or null when the athlete has no wellness */
  sparklines: WellnessSparklines | null;
  /** Activities that arrived since the athlete last looked: the feed rings them */
  newActivityIds: ReadonlySet<string>;
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

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function retainUnchangedPreviewTracks(
  previous: Map<string, PreviewTrack> | undefined,
  next: Map<string, PreviewTrack>
): Map<string, PreviewTrack> {
  if (!previous) return next;
  for (const [id, track] of next) {
    const prior = previous.get(id);
    if (!prior || prior.coordinates.length !== track.coordinates.length) continue;
    const unchanged = track.coordinates.every(
      (point, index) =>
        point.latitude === prior.coordinates[index]?.latitude &&
        point.longitude === prior.coordinates[index]?.longitude
    );
    if (unchanged) next.set(id, prior);
  }
  return next;
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
      // `null` rather than undefined when the athlete has no wellness: the
      // card reads the difference as "the bundle answered" against "there is
      // no bundle, read it yourself".
      sparklines: result.sparklines ?? null,
      newActivityIds: new Set(result.newActivityIds ?? []),
    };
  } catch {
    // empty-on-error: null is "keep what is already on screen", so a failed refresh leaves
    // the last bundle drawn rather than replacing it with an empty one.
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
 * Counters that advance when the engine says a sync reached a terminal state,
 * and when it says it stored wellness. Neither channel's value means anything,
 * only that it moved.
 *
 * The engine handle is fixed at first load, and subscribing does not need an
 * open database: the subscription is a listener map, so it hears a launch sync
 * that settles after this screen mounts. A missing handle stays missing, so
 * there is nothing to wait for.
 */
function useEngineSignals(): { settled: number; wellnessStored: number } {
  const [settled, setSettled] = useState(0);
  const [wellnessStored, setWellnessStored] = useState(0);

  useEffect(() => {
    const subscribeAll = (engine: NonNullable<ReturnType<typeof getEngine>>) => {
      const offSettled = engine.subscribe('syncSettled', () => setSettled((n) => n + 1));
      const offBody = engine.subscribe('bodyStored', (payload) => {
        if ((payload as { kind?: string } | undefined)?.kind !== 'wellness') return;
        setWellnessStored((n) => n + 1);
      });
      return () => {
        offSettled?.();
        offBody?.();
      };
    };

    const engine = getEngine();
    return engine ? subscribeAll(engine) : undefined;
  }, []);

  return { settled, wellnessStored };
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
  refresh: () => void;
} {
  const trigger = useEngineSubscription(['activities', 'sections']);
  // Wellness is written once per sync rather than once per page, so it is not
  // the herd the hold below exists to stop, and it is the number the card's
  // hero reads. Held until the settle, a first sync left the card on the zeros
  // of the read that ran before wellness landed.
  const { settled, wellnessStored } = useEngineSignals();
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
  const publish = useCallback((next: StartupResult) => {
    setData((previous) => ({
      ...next,
      previewTracks: retainUnchangedPreviewTracks(previous?.previewTracks, next.previewTracks),
      newActivityIds:
        previous && sameIds(previous.newActivityIds, next.newActivityIds)
          ? previous.newActivityIds
          : next.newActivityIds,
    }));
  }, []);

  // One deferred read, cancelled by whoever scheduled it. The effects below own
  // their own copy because each cancels on its own dependency change.
  const readSoon = useCallback(() => {
    return runWhenIdle(() => {
      const next = fetchStartupData(idsRef.current);
      if (next) publish(next);
    });
  }, [publish]);

  useEffect(() => {
    if (syncInFlight()) {
      if (readThisSync.current) {
        held.current = true;
        return undefined;
      }
      readThisSync.current = true;
    } else {
      readThisSync.current = false;
    }

    return runWhenIdle(() => {
      const next = fetchStartupData(idsRef.current);
      if (next) publish(next);
    });
  }, [trigger, idsKey, publish]);

  useEffect(() => {
    if (!settleSeen.current) {
      settleSeen.current = true;
      return undefined;
    }
    readThisSync.current = false;
    // A settle with nothing held back has nothing new to report: the last read
    // already saw whatever the sync landed.
    if (!held.current) return undefined;
    held.current = false;

    return runWhenIdle(() => {
      const next = fetchStartupData(idsRef.current);
      if (next) publish(next);
    });
  }, [settled, publish]);

  // The first run is the mount, where the read above has already been scheduled.
  const wellnessSeen = useRef(false);
  useEffect(() => {
    if (!wellnessSeen.current) {
      wellnessSeen.current = true;
      return undefined;
    }
    return readSoon();
  }, [wellnessStored, readSoon]);

  // A pull to refresh reads queries the card is not painted from, so without
  // this the card and the Fitness screen can disagree for as long as the feed
  // is open.
  const refresh = useCallback(() => {
    readSoon();
  }, [readSoon]);

  return { data, refresh };
}
