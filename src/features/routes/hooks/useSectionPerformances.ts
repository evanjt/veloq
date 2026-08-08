import { useState, useEffect, useMemo, useCallback } from 'react';
import { routeEngine, type SectionPerformanceResult } from 'veloqrs';
import type { FrequentSection, DirectionStats } from '@/types';
import { toDirectionStats, castDirection, fromUnixSeconds } from '@/shared/ffi/ffiConversions';

/** How long to wait for Rust to finish a time-stream batch before rendering
 *  whatever landed. Missing streams only cost precision, not correctness. */
const TIME_STREAM_TIMEOUT_MS = 30_000;
const TIME_STREAM_POLL_MS = 400;

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
  /** Best overall record (fastest time) */
  bestRecord: SectionPerformanceRecord | null;
  /** Best record in forward/same direction */
  bestForwardRecord: SectionPerformanceRecord | null;
  /** Best record in reverse direction */
  bestReverseRecord: SectionPerformanceRecord | null;
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
  bestRecord: SectionPerformanceRecord | null;
  bestForwardRecord: SectionPerformanceRecord | null;
  bestReverseRecord: SectionPerformanceRecord | null;
  forwardStats: DirectionStats | null;
  reverseStats: DirectionStats | null;
}

export const EMPTY_PERFORMANCE_VIEW: SectionPerformanceView = {
  records: [],
  bestRecord: null,
  bestForwardRecord: null,
  bestReverseRecord: null,
  forwardStats: null,
  reverseStats: null,
};

/** Convert FFI records to the render shape (Date conversion, direction cast). */
export function toPerformanceView(result: SectionPerformanceResult): SectionPerformanceView {
  const toActivityRecord = (
    r: SectionPerformanceResult['records'][0]
  ): SectionPerformanceRecord => ({
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
    })),
    lapCount: r.lapCount,
    bestTime: r.bestTime,
    bestPace: r.bestPace,
    avgTime: r.avgTime,
    avgPace: r.avgPace,
    direction: castDirection(r.direction),
    sectionDistance: r.sectionDistance,
  });

  return {
    records: result.records.map(toActivityRecord),
    bestRecord: result.bestRecord ? toActivityRecord(result.bestRecord) : null,
    bestForwardRecord: result.bestForwardRecord ? toActivityRecord(result.bestForwardRecord) : null,
    bestReverseRecord: result.bestReverseRecord ? toActivityRecord(result.bestReverseRecord) : null,
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
 * `getActivitiesMissingTimeStreams` round-trip. The poll that observes
 * completion still runs, since Rust cannot push into the JS listener map.
 */
export function useSectionTimeStreamSync(
  allActivityIds: string[],
  knownMissingIds?: string[]
): UseSectionTimeStreamSyncResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0); // For refetch
  const [fetchComplete, setFetchComplete] = useState(false);

  // Fetch ONLY missing streams from API (ones not in Rust cache/SQLite)
  const fetchMissingStreams = useCallback(async () => {
    if (allActivityIds.length === 0) {
      setFetchComplete(true);
      return;
    }

    // Check which activities are missing from cache (memory + SQLite)
    const missingIds =
      knownMissingIds ?? routeEngine.getActivitiesMissingTimeStreams(allActivityIds);

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
      // persists them. Completion is observed, since Rust cannot push into
      // the JS listener map.
      routeEngine.syncTimeStreams(missingIds);

      const deadline = Date.now() + TIME_STREAM_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (routeEngine.getActivitiesMissingTimeStreams(allActivityIds).length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, TIME_STREAM_POLL_MS));
      }

      setFetchComplete(true);
    } catch {
      setError('Failed to load activity streams');
    } finally {
      setIsLoading(false);
    }
  }, [allActivityIds, knownMissingIds]);

  // Fetch missing streams when the activity set changes or refetch is triggered
  useEffect(() => {
    setFetchComplete(false);
    if (allActivityIds.length > 0) {
      fetchMissingStreams();
    } else {
      setFetchComplete(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [section?.activityPortions]);

  const {
    ready: fetchComplete,
    isFetching: isLoading,
    error,
    refetch,
  } = useSectionTimeStreamSync(allActivityIds);

  // Get performance records from Rust engine
  // Rust auto-loads time streams from SQLite if not in memory
  const { records, bestRecord, bestForwardRecord, bestReverseRecord, forwardStats, reverseStats } =
    useMemo(() => {
      if (!section || !fetchComplete) {
        return EMPTY_PERFORMANCE_VIEW;
      }
      try {
        // Get typed performance result directly from Rust engine (no JSON parsing)
        return toPerformanceView(routeEngine.getSectionPerformances(section.id, sportType));
      } catch {
        // Engine may not have data yet - return empty
        return EMPTY_PERFORMANCE_VIEW;
      }
    }, [section, fetchComplete, sportType]);

  return {
    records,
    isLoading: !fetchComplete,
    isFetchingFromApi: isLoading,
    error,
    bestRecord,
    bestForwardRecord,
    bestReverseRecord,
    forwardStats,
    reverseStats,
    refetch,
  };
}
