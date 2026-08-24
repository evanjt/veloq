/**
 * React hooks for the Rust Route Engine.
 *
 * These hooks provide reactive access to route data managed by the Rust engine.
 * State lives in Rust, eliminating FFI overhead for ongoing operations.
 *
 * IMPORTANT: Use initWithPath() for persistent storage (recommended).
 * Data persists across app restarts - GPS tracks, routes, sections are all cached in SQLite.
 */

import { useEffect, useState, useMemo, useRef } from 'react';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { generateSectionName } from '@/features/routes/lib/sectionNaming';
import { convertNativeSectionToApp } from '@/features/routes/lib/sectionConversions';
import { type RouteGroup, type SectionSummary, type GroupSummary } from 'veloqrs';
import type { FrequentSection } from '@/types';

// ============================================================================
// Engine Type Helper
// ============================================================================

type EngineEvent = 'activities' | 'groups' | 'sections';

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Hook to subscribe to engine events and trigger re-renders.
 * Returns a trigger value that changes when any subscribed event fires.
 *
 * If the engine is not available on first mount, polls until it becomes
 * available to avoid permanently missing events.
 */
export function useEngineSubscription(events: EngineEvent[]): number {
  const [trigger, setTrigger] = useState(0);

  // Stable ref for the refresh callback to avoid stale closures
  const refreshRef = useRef(() => setTrigger((t) => t + 1));
  refreshRef.current = () => setTrigger((t) => t + 1);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const eventKey = useMemo(() => events.join(','), [events.join(',')]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribes: (() => void)[] = [];

    function trySubscribe(): boolean {
      const engine = getRouteEngine();
      if (!engine) return false;

      const cb = () => refreshRef.current();
      unsubscribes = events.map((event) => engine.subscribe(event, cb));
      // Trigger initial refresh in case data arrived before subscription
      if (!cancelled) {
        refreshRef.current();
      }
      return true;
    }

    if (!trySubscribe()) {
      // Engine not ready yet - poll until available
      const interval = setInterval(() => {
        if (trySubscribe()) {
          clearInterval(interval);
        }
      }, 200);

      return () => {
        cancelled = true;
        clearInterval(interval);
        unsubscribes.forEach((u) => u());
      };
    }

    return () => {
      cancelled = true;
      unsubscribes.forEach((u) => u());
    };
  }, [eventKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return trigger;
}

/**
 * Factory function to create engine hooks with a consistent pattern.
 *
 * The pattern:
 * 1. Store a refresh trigger counter (not the actual data)
 * 2. Subscribe to engine events
 * 3. Query fresh data from Rust on each render via useMemo
 *
 * @param queryFn - Function to query data from the engine
 * @param events - Engine events to subscribe to
 * @param fallback - Fallback value when engine is unavailable or error occurs
 */
export // ============================================================================
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
}

/**
 * Hook for accessing route groups from the Rust engine.
 * Groups are queried fresh from Rust/SQLite on each refresh (no long-term JS memory storage).
 */
export function useEngineGroups(options: UseEngineGroupsOptions = {}): UseEngineGroupsResult {
  const { minActivities = 2, sortBy = 'count', enabled = true } = options;
  const trigger = useEngineSubscription(['groups']);

  return useMemo(() => {
    try {
      if (!enabled) return { groups: [], totalCount: 0 };
      const engine = getRouteEngine();
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
    } catch {
      return { groups: [], totalCount: 0 };
    }
  }, [trigger, minActivities, sortBy, enabled]);
}

interface UseEngineSectionsOptions {
  /** Filter by sport type */
  sportType?: string;
  /** Minimum visit count */
  minVisits?: number;
  /** Whether to run the hook (default: true). When false, skips FFI calls and returns empty defaults. */
  enabled?: boolean;
}

interface UseEngineSectionsResult {
  /** List of frequent sections */
  sections: FrequentSection[];
  /** Total number of sections */
  totalCount: number;
}

/**
 * Hook for accessing frequent sections from the Rust engine.
 * Sections are queried fresh from Rust/SQLite on each refresh (no long-term JS memory storage).
 */
export function useEngineSections(options: UseEngineSectionsOptions = {}): UseEngineSectionsResult {
  const { sportType, minVisits = 1, enabled = true } = options;
  const trigger = useEngineSubscription(['sections']);

  return useMemo(() => {
    if (!enabled) return { sections: [], totalCount: 0 };
    try {
      const engine = getRouteEngine();
      if (!engine) return { sections: [], totalCount: 0 };

      const nativeSections = engine.getSectionsFiltered(sportType, minVisits);

      // Convert from native GpsPoint to app RoutePoint format and apply display names
      const convertedSections: FrequentSection[] = nativeSections.map((native) => {
        const converted = convertNativeSectionToApp(native);
        return {
          ...converted,
          name: generateSectionName(converted),
        };
      });

      return {
        sections: convertedSections,
        totalCount: convertedSections.length,
      };
    } catch (e) {
      if (__DEV__) {
        console.warn('[useEngineSections] threw', e);
      }
      return { sections: [], totalCount: 0 };
    }
  }, [trigger, sportType, minVisits, enabled]);
}

/**
 * Total section count without loading any polylines or summaries. Cheap SQL
 * COUNT via `getSectionCount()`. Use this to drive UI that only needs to know
 * whether sections exist (e.g. a toggle button) while deferring the heavy
 * polyline load behind a separate `useEngineSections({ enabled })` gate.
 */
export function useEngineSectionCount(): number {
  const trigger = useEngineSubscription(['sections']);

  return useMemo(() => {
    try {
      return getRouteEngine()?.getSectionCount() ?? 0;
    } catch {
      return 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
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
  const trigger = useEngineSubscription(['sections']);

  return useMemo(() => {
    if (!enabled) return { totalCount: 0, summaries: [] };
    try {
      const engine = getRouteEngine();
      if (!engine) return { totalCount: 0, summaries: [] };

      // Visit-count filter + sort done in Rust; TS only fills display names.
      const { totalCount, summaries: rawSummaries } = engine.getFilteredSectionSummaries(
        sportType,
        minVisits,
        'visits'
      );

      const summaries = rawSummaries.map((s) => ({
        ...s,
        name: s.name || generateSectionName(s),
      }));

      return { totalCount, summaries };
    } catch {
      return { totalCount: 0, summaries: [] };
    }
  }, [trigger, sportType, minVisits, enabled]);
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
}

/**
 * Query-on-demand hook for group summaries (lightweight, no activity ID arrays).
 * Subscribes to engine events but only stores a refresh counter.
 * Data is queried fresh from Rust/SQLite on each render.
 */
export function useGroupSummaries(options: UseGroupSummariesOptions = {}): UseGroupSummariesResult {
  const { minActivities = 2, sortBy = 'count' } = options;
  const trigger = useEngineSubscription(['groups']);

  return useMemo(() => {
    try {
      const engine = getRouteEngine();
      if (!engine) return { totalCount: 0, summaries: [] };

      // Filter + sort pushed into Rust.
      return engine.getFilteredGroupSummaries(minActivities, sortBy);
    } catch {
      return { totalCount: 0, summaries: [] };
    }
  }, [trigger, minActivities, sortBy]);
}

// ============================================================================
// Simple hooks without factory (unique patterns)
// ============================================================================

interface UseConsensusRouteResult {
  /** Consensus route points [{ lat, lng }, ...] or null if not available */
  points: { lat: number; lng: number }[] | null;
  /** Whether the consensus is being computed */
  isLoading: boolean;
}

/**
 * Hook for getting the consensus (representative) route for a group.
 */
export function useConsensusRoute(groupId: string | null): UseConsensusRouteResult {
  const [points, setPoints] = useState<
    | {
        lat: number;
        lng: number;
      }[]
    | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!groupId) {
      setPoints(null);
      return;
    }

    setIsLoading(true);
    const engine = getRouteEngine();
    const gpsPoints = engine ? engine.getConsensusRoute(groupId) : [];

    if (gpsPoints.length > 0) {
      setPoints(gpsPoints.map((p) => ({ lat: p.latitude, lng: p.longitude })));
    } else {
      setPoints(null);
    }
    setIsLoading(false);
  }, [groupId]);

  return { points, isLoading };
}

interface UseSectionDetailResult {
  /** Full section data (with polyline) or null if not found */
  section: FrequentSection | null;
}

/**
 * Query-on-demand hook for a single section's full data.
 * Fetches from Rust/SQLite with LRU caching.
 * Converts GpsPoint format to RoutePoint format.
 */
export function useSectionDetail(sectionId: string | null): UseSectionDetailResult {
  const section = useMemo(() => {
    if (!sectionId) return null;

    const engine = getRouteEngine();
    if (!engine) return null;

    try {
      const native = engine.getSectionById(sectionId);
      if (native) {
        const converted = convertNativeSectionToApp(native);
        return {
          ...converted,
          name: converted.name || generateSectionName(converted),
        };
      }
      return null;
    } catch {
      return null;
    }
  }, [sectionId]);

  return { section };
}

interface UseGroupDetailResult {
  /** Full group data or null if not found */
  group: RouteGroup | null;
}

/**
 * Query-on-demand hook for a single group's full data.
 * Fetches from Rust/SQLite with LRU caching.
 */
export function useGroupDetail(groupId: string | null): UseGroupDetailResult {
  const trigger = useEngineSubscription(['groups']);

  const group = useMemo(() => {
    if (!groupId) return null;

    const engine = getRouteEngine();
    if (!engine) return null;

    try {
      return engine.getGroupById(groupId);
    } catch {
      return null;
    }
  }, [groupId, trigger]);

  return { group };
}

interface UseSectionPolylineResult {
  /** Section polyline as RoutePoints (lat/lng), or empty array if not found */
  polyline: { lat: number; lng: number }[];
}

/**
 * Lazy-load a single section's polyline on-demand.
 * This is fast (Rust query with LRU caching) and avoids loading ALL polylines upfront.
 * Use this in list row components to fetch polylines only for visible items.
 */
export function useSectionPolyline(sectionId: string | null): UseSectionPolylineResult {
  const polyline = useMemo(() => {
    if (!sectionId) return [];

    const engine = getRouteEngine();
    if (!engine) return [];

    try {
      // Get polyline from Rust (uses LRU cache)
      const gpsPoints = engine.getSectionPolyline(sectionId);
      // Convert GpsPoint[] to {lat, lng}[]
      return gpsPoints.map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
      }));
    } catch {
      return [];
    }
  }, [sectionId]);

  return { polyline };
}
