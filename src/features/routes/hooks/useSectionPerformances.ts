import { useState, useEffect, useMemo, useCallback } from 'react';
import { engine, type SectionPerformanceResult } from 'veloqrs';
import type { FrequentSection, DirectionStats } from '@/types';
import { toDirectionStats, castDirection, fromUnixSeconds } from '@/shared/ffi/ffiConversions';
import { awaitTimeStreams } from '@/features/routes/lib/awaitTimeStreams';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { DirectionBests } from '@/features/insights';

/** How long to wait for Rust to finish a time-stream batch before rendering
 *  whatever landed. Missing streams only cost precision, not correctness. */
const TIME_STREAM_TIMEOUT_MS = 30_000;

/**
 * Individual lap/traversal of a section
 */
export interface SectionLap {
  id: string;
  activityId: string;
  /** Actual time to traverse section (seconds) */
  time: number;
  /** Actual pace (m/s) = distance / time */
  pace: number;
  /** Section distance for this lap */
  distance: number;
  /** Direction relative to representative polyline */
  direction: 'same' | 'reverse';
  /** Start index into activity GPS track */
  startIndex: number;
  /** End index into activity GPS track */
  endIndex: number;
  /** Mean heart rate over the lap, when the activity carried a stream. */
  avgHr: number | null;
  /** Mean watts over the lap, when the activity carried a power stream. */
  avgPower: number | null;
  /** The athlete excluded this lap. Only the lap list's records carry one. */
  excluded: boolean;
}

/**
 * Performance record for an activity on a section.
 * Groups multiple laps together with best/average stats.
 */
export interface SectionPerformanceRecord {
  activityId: string;
  activityName: string;
  activityDate: Date;
  /** All laps/traversals of this section */
  laps: SectionLap[];
  /** Number of times this activity crossed the section */
  lapCount: number;
  /** Best (fastest) time across all laps */
  bestTime: number;
  /** Best (highest) pace across all laps (m/s) */
  bestPace: number;
  bestForwardTime: number | null;
  bestReverseTime: number | null;
  /** Average time across all laps */
  avgTime: number;
  /** Average pace across all laps (m/s) */
  avgPace: number;
  /** Direction of the first/primary lap */
  direction: 'same' | 'reverse';
  /** Section distance */
  sectionDistance: number;
}

interface UseSectionPerformancesResult {
  /** Performance records grouped by activity */
  records: SectionPerformanceRecord[];
  /** Whether data is still loading (not yet ready to display) */
  isLoading: boolean;
  /** Whether streams are being fetched from API */
  isFetchingFromApi: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Best record in forward/same direction */
  bestForwardRecord: SectionPerformanceRecord | null;
  /** Best record in reverse direction */
  bestReverseRecord: SectionPerformanceRecord | null;
  /** Whether the forward best strictly beats another forward outing */
  bestForwardIsPr: boolean;
  /** Whether the reverse best strictly beats another reverse outing */
  bestReverseIsPr: boolean;
  /** Both directions' bests with the engine's PR verdict on each */
  bests: DirectionBests;
  /** Summary stats for forward direction */
  forwardStats: DirectionStats | null;
  /** Summary stats for reverse direction */
  reverseStats: DirectionStats | null;
  /** Refetch all streams */
  refetch: () => void;
}

/** Performance records in the shape the section screens render. */
export interface SectionPerformanceView {
  records: SectionPerformanceRecord[];
  bestForwardRecord: SectionPerformanceRecord | null;
  bestReverseRecord: SectionPerformanceRecord | null;
  bestForwardIsPr: boolean;
  bestReverseIsPr: boolean;
  forwardStats: DirectionStats | null;
  reverseStats: DirectionStats | null;
}

export const EMPTY_PERFORMANCE_VIEW: SectionPerformanceView = {
  records: [],
  bestForwardRecord: null,
  bestReverseRecord: null,
  bestForwardIsPr: false,
  bestReverseIsPr: false,
  forwardStats: null,
  reverseStats: null,
};

/** One FFI record in the render shape (Date conversion, direction cast). */
export function toPerformanceRecord(
  r: SectionPerformanceResult['records'][0]
): SectionPerformanceRecord {
  return {
    activityId: r.activityId,
    activityName: r.activityName,
    activityDate: fromUnixSeconds(r.activityDate) ?? new Date(),
    laps: (r.laps || []).map((l) => ({
      id: l.id,
      activityId: l.activityId,
      time: l.time,
      pace: l.pace,
      distance: l.distance,
      direction: castDirection(l.direction),
      startIndex: l.startIndex,
      endIndex: l.endIndex,
      avgHr: l.avgHr ?? null,
      avgPower: l.avgPower ?? null,
      excluded: l.excluded,
    })),
    lapCount: r.lapCount,
    bestTime: r.bestTime,
    bestPace: r.bestPace,
    bestForwardTime: r.bestForwardTime ?? null,
    bestReverseTime: r.bestReverseTime ?? null,
    avgTime: r.avgTime,
    avgPace: r.avgPace,
    direction: castDirection(r.direction),
    sectionDistance: r.sectionDistance,
  };
}

/** Convert FFI records to the render shape (Date conversion, direction cast). */
export function toPerformanceView(result: SectionPerformanceResult): SectionPerformanceView {
  return {
    records: result.records.map(toPerformanceRecord),
    bestForwardRecord: result.bestForwardRecord
      ? toPerformanceRecord(result.bestForwardRecord)
      : null,
    bestReverseRecord: result.bestReverseRecord
      ? toPerformanceRecord(result.bestReverseRecord)
      : null,
    bestForwardIsPr: result.bestForwardIsPr,
    bestReverseIsPr: result.bestReverseIsPr,
    forwardStats: toDirectionStats(result.forwardStats),
    reverseStats: toDirectionStats(result.reverseStats),
  };
}

export interface UseSectionTimeStreamSyncResult {
  /** Whether every stream the records need has landed (or timed out) */
  ready: boolean;
  /** Whether streams are currently being fetched */
  isFetching: boolean;
  /** Error message when the fetch failed */
  error: string | null;
  /** Re-run the sync */
  refetch: () => void;
}

/**
 * Wait for the time streams a section's records depend on.
 *
 * `knownMissingIds` lets a caller that already read the gap skip the first
 * `getActivitiesMissingTimeStreams` round-trip. Completion is announced by
 * Rust as each stream lands, so nothing is read between the request and the
 * answer.
 */
export function useSectionTimeStreamSync(
  allActivityIds: string[],
  knownMissingIds?: string[]
): UseSectionTimeStreamSyncResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0); // For refetch
  const [fetchComplete, setFetchComplete] = useState(false);

  // Fetch ONLY missing streams from API (ones not in Rust cache/SQLite).
  //
  // The signal is what makes a wait belong to one run of the effect. Switching
  // sections quickly used to leave the previous `awaitTimeStreams` running, so
  // it settled against the new section's half-populated cache and flipped
  // `ready` true early, and it held a subscription and a thirty-second timer
  // for the full timeout past unmount.
  const fetchMissingStreams = useCallback(
    async (signal: AbortSignal) => {
      if (allActivityIds.length === 0) {
        setFetchComplete(true);
        return;
      }

      // Check which activities are missing from cache (memory + SQLite)
      const missingIds = knownMissingIds ?? engine.getActivitiesMissingTimeStreams(allActivityIds);

      // If all time streams are cached, we're done immediately
      if (missingIds.length === 0) {
        setFetchComplete(true);
        return;
      }

      // Only show loading for API fetches
      setIsLoading(true);
      setError(null);

      try {
        // Rust fetches the missing streams behind the shared governor and
        // persists them, announcing each one as it lands.
        engine.syncTimeStreams(missingIds);

        await awaitTimeStreams(missingIds, { timeoutMs: TIME_STREAM_TIMEOUT_MS, signal });

        if (signal.aborted) return;
        setFetchComplete(true);
      } catch {
        if (signal.aborted) return;
        setError('Failed to load activity streams');
      } finally {
        if (!signal.aborted) setIsLoading(false);
      }
    },
    [allActivityIds, knownMissingIds]
  );

  // Fetch missing streams when the activity set changes or refetch is triggered
  useEffect(() => {
    setFetchComplete(false);
    const run = new AbortController();
    // An empty list settles inside, so there is one exit and one cleanup.
    fetchMissingStreams(run.signal);
    return () => run.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The fetch key retries the current activity set.
  }, [allActivityIds, fetchKey]);

  const refetch = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  return { ready: fetchComplete, isFetching: isLoading, error, refetch };
}

/**
 * Hook for calculating accurate section performance times.
 * Uses cached time streams from Rust engine (SQLite) when available.
 * Only fetches from API for activities missing from cache.
 *
 * @param section - The section to calculate performances for
 * @param sportType - Optional sport type filter for cross-sport sections
 */
export function useSectionPerformances(
  section: FrequentSection | null,
  sportType?: string
): UseSectionPerformancesResult {
  // Get unique activity IDs from section portions (engine already validated these)
  const allActivityIds = useMemo(() => {
    if (!section?.activityPortions) return [];
    const ids = new Set<string>();
    for (const p of section.activityPortions) {
      ids.add(p.activityId);
    }
    return Array.from(ids);
  }, [section]);

  const {
    ready: fetchComplete,
    isFetching: isLoading,
    error,
    refetch,
  } = useSectionTimeStreamSync(allActivityIds);

  // Detection that adds a traversal to this section moves none of the other
  // keys, so the records are read again when the engine announces it.
  const readSections = useEngineRead(['sections', 'detectionApplied']);

  // Get performance records from Rust engine
  // Rust auto-loads time streams from SQLite if not in memory
  const {
    records,
    bestForwardRecord,
    bestReverseRecord,
    bestForwardIsPr,
    bestReverseIsPr,
    forwardStats,
    reverseStats,
  } = useMemo(() => {
    if (!section || !fetchComplete) {
      return EMPTY_PERFORMANCE_VIEW;
    }
    try {
      // Get typed performance result directly from Rust engine (no JSON parsing)
      const result = readSections((client) => client.getSectionPerformances(section.id, sportType));
      return result ? toPerformanceView(result) : EMPTY_PERFORMANCE_VIEW;
    } catch {
      // Engine may not have data yet - return empty
      return EMPTY_PERFORMANCE_VIEW;
    }
  }, [section, fetchComplete, sportType, readSections]);

  const bests = useMemo<DirectionBests>(
    () => ({
      forward: bestForwardRecord,
      reverse: bestReverseRecord,
      forwardIsPr: bestForwardIsPr,
      reverseIsPr: bestReverseIsPr,
    }),
    [bestForwardRecord, bestReverseRecord, bestForwardIsPr, bestReverseIsPr]
  );

  return {
    records,
    isLoading: !fetchComplete,
    isFetchingFromApi: isLoading,
    error,
    bestForwardRecord,
    bestReverseRecord,
    bestForwardIsPr,
    bestReverseIsPr,
    bests,
    forwardStats,
    reverseStats,
    refetch,
  };
}
