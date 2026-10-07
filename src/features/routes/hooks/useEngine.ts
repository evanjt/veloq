/**
 * React hooks for the Rust Route Engine.
 *
 * These hooks provide reactive access to route data managed by the Rust engine.
 * State lives in Rust, eliminating FFI overhead for ongoing operations.
 *
 * IMPORTANT: Use initWithPath() for persistent storage (recommended).
 * Data persists across app restarts - GPS tracks, routes, sections are all cached in SQLite.
 */

import { useEffect, useState, useMemo } from 'react';
import { useEngineRead, useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { decodeCoords, type RouteGroup, type SectionSummary, type GroupSummary } from 'veloqrs';
import type { LatLngShort } from '@/shared/geo/distance';

// ============================================================================
// Engine Type Helper
// ============================================================================

export { useEngineSubscription };
export type { EngineEvent } from '@/shared/native/useEngineSubscription';

// ============================================================================
// Data Hooks with Options
// ============================================================================

interface UseEngineGroupsOptions {
  /** Minimum number of activities in group */
  minActivities?: number;
  /** Sort order */
  sortBy?: 'count' | 'id';
  /** When false, skip the getGroups() FFI entirely (used to defer off a screen's mount frame) */
  enabled?: boolean;
}

interface UseEngineGroupsResult {
  /** List of route groups */
  groups: RouteGroup[];
  /** Total number of groups */
  totalCount: number;
  /** What the engine threw, when the read failed. Empty groups with no error is an empty library. */
  error?: unknown;
}

/**
 * Hook for accessing route groups from the Rust engine.
 * Groups are queried fresh from Rust/SQLite on each refresh (no long-term JS memory storage).
 */
export function useEngineGroups(options: UseEngineGroupsOptions = {}): UseEngineGroupsResult {
  const { minActivities = 2, sortBy = 'count', enabled = true } = options;
  const readGroups = useEngineRead(['groups']);

  return useMemo(() => {
    try {
      if (!enabled) return { groups: [], totalCount: 0 };
      const engine = readGroups((open) => open);
      if (!engine) return { groups: [], totalCount: 0 };

      const allGroups = engine.getGroups();
      let filtered = allGroups.filter((g) => g.activityIds?.length >= minActivities);

      if (sortBy === 'count') {
        filtered.sort((a, b) => (b.activityIds?.length ?? 0) - (a.activityIds?.length ?? 0));
      } else {
        filtered.sort((a, b) => a.groupId.localeCompare(b.groupId));
      }

      return {
        groups: filtered,
        totalCount: allGroups.length,
      };
    } catch (error) {
      return { groups: [], totalCount: 0, error };
    }
  }, [readGroups, minActivities, sortBy, enabled]);
}

interface UseEngineSectionsOptions {
  /** Filter by sport type */
  sportType?: string;
  /** Minimum visit count */
  minVisits?: number;
  /** Whether to run the hook (default: true). When false, skips FFI calls and returns empty defaults. */
  enabled?: boolean;
}

/** What the regional map draws one section with. */
export interface MapSection {
  id: string;
  name: string;
  visitCount: number;
  distanceMeters: number;
  polyline: LatLngShort[];
}

interface UseMapSectionsResult {
  sections: MapSection[];
  totalCount: number;
  /** What the engine threw, when the read failed. */
  error?: unknown;
}

/**
 * Sections for the regional map's overlay.
 *
 * Six fields and a line, not the whole record: the activity ids, one
 * `activity_portions` entry per traversal and the point density for every
 * section go unread by the map. The label is still built in JavaScript because it is built from
 * the athlete's own units, which Rust does not hold.
 */
export function useMapSections(options: UseEngineSectionsOptions = {}): UseMapSectionsResult {
  const { sportType, minVisits = 1, enabled = true } = options;
  const readSections = useEngineRead(['sections']);

  return useMemo(() => {
    if (!enabled) return { sections: [], totalCount: 0 };
    try {
      const engine = readSections((open) => open);
      if (!engine) return { sections: [], totalCount: 0 };

      const sections: MapSection[] = engine.getMapSections(sportType, minVisits).map((native) => ({
        id: native.id,
        name: native.name ?? '',
        visitCount: native.visitCount,
        distanceMeters: native.distanceMeters,
        polyline: decodeCoords(native.encodedPolyline).map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
        })),
      }));

      return { sections, totalCount: sections.length };
    } catch (error) {
      return { sections: [], totalCount: 0, error };
    }
  }, [readSections, sportType, minVisits, enabled]);
}

/**
 * Total section count without loading any polylines or summaries. Cheap SQL
 * COUNT via `getSectionCount()`. Use this to drive UI that only needs to know
 * whether sections exist (e.g. a toggle button) while deferring the heavy
 * polyline load behind a separate `useMapSections({ enabled })` gate.
 */
export function useEngineSectionCount(): { count: number; error?: unknown } {
  const readSections = useEngineRead(['sections']);

  return useMemo(() => {
    try {
      return { count: readSections((engine) => engine.getSectionCount()) ?? 0 };
    } catch (error) {
      return { count: 0, error };
    }
  }, [readSections]);
}

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
  const readSections = useEngineRead(['sections', 'detectionApplied']);

  return useMemo(() => {
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
}

interface UseGroupSummariesOptions {
  /** Minimum number of activities in group */
  minActivities?: number;
  /** Sort order - 'count' (default) or 'name' (alphabetical by groupId) */
  sortBy?: 'count' | 'name';
}

interface UseGroupSummariesResult {
  /** Total group count (fast SQL query) */
  totalCount: number;
  /** Filtered group summaries (queried on-demand, no activity ID arrays) */
  summaries: GroupSummary[];
  /** What the engine threw, when the read failed. */
  error?: unknown;
}

/**
 * Query-on-demand hook for group summaries (lightweight, no activity ID arrays).
 * Subscribes to engine events but only stores a refresh counter.
 * Data is queried fresh from Rust/SQLite on each render.
 */
export function useGroupSummaries(options: UseGroupSummariesOptions = {}): UseGroupSummariesResult {
  const { minActivities = 2, sortBy = 'count' } = options;
  const readGroups = useEngineRead(['groups']);

  return useMemo(() => {
    try {
      const engine = readGroups((open) => open);
      if (!engine) return { totalCount: 0, summaries: [] };

      // Filter + sort pushed into Rust.
      return engine.getFilteredGroupSummaries(minActivities, sortBy);
    } catch (error) {
      return { totalCount: 0, summaries: [], error };
    }
  }, [readGroups, minActivities, sortBy]);
}

// ============================================================================
// Simple hooks without factory (unique patterns)
// ============================================================================

interface UseRepresentativeRouteResult {
  /** Representative route points [{ lat, lng }, ...] or null if not available */
  points: LatLngShort[] | null;
  /** Whether the representative track is being loaded */
  isLoading: boolean;
}

/**
 * Hook for getting the representative route for a group.
 */
export function useRepresentativeRoute(groupId: string | null): UseRepresentativeRouteResult {
  const readGroups = useEngineRead(groupId ? ['groups'] : []);
  const [points, setPoints] = useState<LatLngShort[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!groupId) {
      setPoints(null);
      return;
    }

    setIsLoading(true);
    const encoded = readGroups((engine) => engine.getRepresentativeRoute(groupId));
    const decoded = encoded ? decodeCoords(encoded) : [];

    if (decoded.length > 0) {
      setPoints(decoded.map((p) => ({ lat: p.latitude, lng: p.longitude })));
    } else {
      setPoints(null);
    }
    setIsLoading(false);
  }, [groupId, readGroups]);

  return { points, isLoading };
}
