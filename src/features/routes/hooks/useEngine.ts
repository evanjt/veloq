/**
 * React hooks for the Rust Route Engine.
 *
 * These hooks provide reactive access to route data managed by the Rust engine.
 * State lives in Rust, eliminating FFI overhead for ongoing operations.
 *
 * IMPORTANT: Use initWithPath() for persistent storage (recommended).
 * Data persists across app restarts - GPS tracks, routes, sections are all cached in SQLite.
 */

import { useMemo } from 'react';
import {
  useEngineRead,
  useEngineSubscription,
  useReadRetry,
} from '@/shared/native/useEngineSubscription';
import type { SectionSummary, GroupSummary } from 'veloqrs';

// ============================================================================
// Engine Type Helper
// ============================================================================

export { useEngineSubscription };
export type { EngineEvent } from '@/shared/native/useEngineSubscription';

// ============================================================================
// Data Hooks with Options
// ============================================================================

interface UseSectionSummariesOptions {
  /** Filter by sport type */
  sportType?: string;
  /** Minimum visit count */
  minVisits?: number;
  /** Whether to run the hook (default: true). When false, skips FFI calls and returns empty defaults. */
  enabled?: boolean;
}

interface UseSectionSummariesResult {
  /** Total section count (fast SQL query) */
  totalCount: number;
  /** Filtered section summaries (queried on-demand, no polylines) */
  summaries: SectionSummary[];
  /** What the engine threw, when the read failed. */
  error?: unknown;
  /** Reads again after a failure. */
  retry: () => void;
}

/**
 * Query-on-demand hook for section summaries (lightweight, no polylines).
 * Subscribes to engine events but only stores a refresh counter.
 * Data is queried fresh from Rust/SQLite on each render.
 */
export function useSectionSummaries(
  options: UseSectionSummariesOptions = {}
): UseSectionSummariesResult {
  const { sportType, minVisits = 1, enabled = true } = options;
  const [attempt, retry] = useReadRetry();
  const readSections = useEngineRead(['sections', 'detectionApplied'], [attempt]);

  const read = useMemo(() => {
    if (!enabled) return { totalCount: 0, summaries: [] };
    try {
      const engine = readSections((open) => open);
      if (!engine) return { totalCount: 0, summaries: [] };

      // Visit-count filter + sort done in Rust; TS only fills display names.
      const { totalCount, summaries: rawSummaries } = engine.getFilteredSectionSummaries(
        sportType,
        minVisits,
        'visits'
      );

      return { totalCount, summaries: rawSummaries };
    } catch (error) {
      return { totalCount: 0, summaries: [], error };
    }
  }, [readSections, sportType, minVisits, enabled]);
  return useMemo(() => ({ ...read, retry }), [read, retry]);
}

interface UseGroupSummariesOptions {
  /** Minimum number of activities in group */
  minActivities?: number;
  /** Sort order - 'count' (default) or 'name' (alphabetical by groupId) */
  sortBy?: 'count' | 'name';
  /** Whether to run the hook (default: true). When false, skips FFI calls and returns empty defaults. */
  enabled?: boolean;
}

interface UseGroupSummariesResult {
  /** Total group count (fast SQL query) */
  totalCount: number;
  /** Filtered group summaries (queried on-demand, no activity ID arrays) */
  summaries: GroupSummary[];
  /** What the engine threw, when the read failed. */
  error?: unknown;
  /** Reads again after a failure. */
  retry: () => void;
}

/**
 * Query-on-demand hook for group summaries (lightweight, no activity ID arrays).
 * Subscribes to engine events but only stores a refresh counter.
 * Data is queried fresh from Rust/SQLite on each render.
 */
export function useGroupSummaries(options: UseGroupSummariesOptions = {}): UseGroupSummariesResult {
  const { minActivities = 2, sortBy = 'count', enabled = true } = options;
  const [attempt, retry] = useReadRetry();
  const readGroups = useEngineRead(['groups'], [attempt]);

  const read = useMemo(() => {
    if (!enabled) return { totalCount: 0, summaries: [] };
    try {
      const engine = readGroups((open) => open);
      if (!engine) return { totalCount: 0, summaries: [] };

      // Filter + sort pushed into Rust.
      return engine.getFilteredGroupSummaries(minActivities, sortBy);
    } catch (error) {
      return { totalCount: 0, summaries: [], error };
    }
  }, [readGroups, minActivities, sortBy, enabled]);
  return useMemo(() => ({ ...read, retry }), [read, retry]);
}
