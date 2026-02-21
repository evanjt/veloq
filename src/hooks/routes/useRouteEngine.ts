/**
 * React hooks for the Rust Route Engine.
 *
 * These hooks provide reactive access to route data managed by the Rust engine.
 * State lives in Rust, eliminating FFI overhead for ongoing operations.
 *
 * IMPORTANT: Use initWithPath() for persistent storage (recommended).
 * Data persists across app restarts - GPS tracks, routes, sections are all cached in SQLite.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';
import { getRouteEngine, getRouteDbPath } from '@/lib/native/routeEngine';
import { generateSectionName } from '@/lib/utils/sectionNaming';
import { convertNativeSectionToApp } from './sectionConversions';
import { type RouteGroup, type SectionSummary, type GroupSummary } from 'veloqrs';
import type { FrequentSection } from '@/types';

// ============================================================================
// Engine Type Helper
// ============================================================================

type Engine = ReturnType<typeof getRouteEngine>;
type EngineEvent = 'activities' | 'groups' | 'sections';

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Hook to subscribe to engine events and trigger re-renders.
 * Returns a trigger value that changes when any subscribed event fires.
 */
export function useEngineSubscription(events: EngineEvent[]): number {
  const [trigger, setTrigger] = useState(0);

  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;

    const refresh = () => setTrigger((t) => t + 1);
    const unsubscribes = events.map((event) => engine.subscribe(event, refresh));

    return () => unsubscribes.forEach((u) => u());
  }, [events.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

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
export function createEngineHook<T>(
  queryFn: (engine: NonNullable<Engine>) => T,
  events: EngineEvent[],
  fallback: T
): () => T {
  return function useEngineHook(): T {
    const trigger = useEngineSubscription(events);

    return useMemo(() => {
      try {
        const engine = getRouteEngine();
        if (!engine) return fallback;
        return queryFn(engine);
      } catch {
        return fallback;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trigger]);
  };
}

// ============================================================================
// useRouteEngine - Main hook for engine access (lifecycle, not data)
// ============================================================================

interface UseRouteEngineResult {
  /** Whether the engine is initialized */
  isReady: boolean;
  /** Number of activities in the engine */
  activityCount: number;
  /** Whether using persistent storage (SQLite) */
  isPersistent: boolean;
  /** Initialize with persistent storage (RECOMMENDED - data survives app restarts) */
  initWithPath: (dbPath?: string) => boolean;
  /** Clear all engine state */
  clear: () => void;
}

/**
 * Main hook for route engine lifecycle management.
 * Initialize once at app startup, typically in the root layout.
 *
 * IMPORTANT: Use initWithPath() for persistent storage.
 * This stores GPS tracks, routes, and sections in SQLite for instant loading.
 */
export function useRouteEngine(): UseRouteEngineResult {
  const [isReady, setIsReady] = useState(false);
  const [activityCount, setActivityCount] = useState(0);
  const [isPersistent, setIsPersistent] = useState(false);

  /**
   * Initialize with persistent SQLite storage (RECOMMENDED).
   * Data persists across app restarts - routes load instantly.
   */
  const initWithPath = useCallback((dbPath?: string): boolean => {
    const engine = getRouteEngine();
    if (!engine) return false;

    const path = dbPath || getRouteDbPath();
    if (!path) return false;

    // Security: Validate path to prevent path traversal attacks
    const docDir = FileSystem.documentDirectory;
    if (!docDir) return false;

    // Normalize document directory (strip file:// prefix for comparison)
    const normalizedDocDir = docDir.startsWith('file://') ? docDir.slice(7) : docDir;

    // Normalize the provided path (strip file:// prefix if present)
    const normalizedPath = path.startsWith('file://') ? path.slice(7) : path;

    // Reject paths containing path traversal sequences
    if (normalizedPath.includes('..')) {
      return false;
    }

    // Ensure path is within the document directory
    if (!normalizedPath.startsWith(normalizedDocDir)) {
      return false;
    }

    const success = engine.initWithPath(normalizedPath);

    if (success) {
      setIsReady(true);
      setIsPersistent(true);
      setActivityCount(engine.getActivityCount());
    }
    return success;
  }, []);

  const clear = useCallback(() => {
    const engine = getRouteEngine();
    if (engine) engine.clear();
    setActivityCount(0);
  }, []);

  // Subscribe to activity changes
  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;
    const unsubscribe = engine.subscribe('activities', () => {
      const eng = getRouteEngine();
      setActivityCount(eng ? eng.getActivityCount() : 0);
    });
    return unsubscribe;
  }, []);

  // Check if already initialized on mount (e.g., if initialized elsewhere)
  useEffect(() => {
    const engine = getRouteEngine();
    if (engine?.isInitialized()) {
      setIsReady(true);
      setIsPersistent(engine.isPersistent());
      setActivityCount(engine.getActivityCount());
    }
  }, []);

  return { isReady, activityCount, isPersistent, initWithPath, clear };
}

// ============================================================================
// Data Hooks with Options
// ============================================================================

interface UseEngineGroupsOptions {
  /** Minimum number of activities in group */
  minActivities?: number;
  /** Sort order */
  sortBy?: 'count' | 'id';
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
  const { minActivities = 2, sortBy = 'count' } = options;
  const trigger = useEngineSubscription(['groups']);

  return useMemo(() => {
    try {
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
  }, [trigger, minActivities, sortBy]);
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

      const allNativeSections = engine.getSections();
      let filtered = allNativeSections;

      if (sportType) {
        filtered = filtered.filter((s) => s.sportType === sportType);
      }

      filtered = filtered.filter((s) => s.visitCount >= minVisits);

      // Convert from native GpsPoint to app RoutePoint format and apply display names
      const convertedSections: FrequentSection[] = filtered.map((native) => {
        const converted = convertNativeSectionToApp(native);
        return {
          ...converted,
          name: generateSectionName(converted),
        };
      });

      return {
        sections: convertedSections,
        totalCount: allNativeSections.length,
      };
    } catch {
      return { sections: [], totalCount: 0 };
    }
  }, [trigger, sportType, minVisits, enabled]);
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
  count: number;
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
    if (!enabled) return { count: 0, summaries: [] };
    try {
      const engine = getRouteEngine();
      if (!engine) return { count: 0, summaries: [] };

      const count = engine.getSectionCount();

      const rawSummaries = sportType
        ? engine.getSectionSummariesForSport(sportType)
        : engine.getSectionSummaries();

      // Apply minimum visits filter and generate display names
      const summaries = rawSummaries
        .filter((s) => s.visitCount >= minVisits)
        .map((s) => ({
          ...s,
          name: s.name || generateSectionName(s),
        }));

      return { count, summaries };
    } catch {
      return { count: 0, summaries: [] };
    }
  }, [trigger, sportType, minVisits, enabled]);
}

interface UseGroupSummariesOptions {
  /** Minimum number of activities in group */
  minActivities?: number;
  /** Sort order */
  sortBy?: 'count' | 'id';
}

interface UseGroupSummariesResult {
  /** Total group count (fast SQL query) */
  count: number;
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
      if (!engine) return { count: 0, summaries: [] };

      const count = engine.getGroupCount();
      let rawSummaries = engine.getGroupSummaries();

      // Apply filters
      rawSummaries = rawSummaries.filter((g) => g.activityCount >= minActivities);

      // Sort
      if (sortBy === 'count') {
        rawSummaries.sort((a, b) => b.activityCount - a.activityCount);
      } else {
        rawSummaries.sort((a, b) => a.groupId.localeCompare(b.groupId));
      }

      return { count, summaries: rawSummaries };
    } catch {
      return { count: 0, summaries: [] };
    }
  }, [trigger, minActivities, sortBy]);
}

// ============================================================================
// Simple hooks without factory (unique patterns)
// ============================================================================

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface UseViewportActivitiesResult {
  /** Activity IDs visible in the viewport */
  activityIds: string[];
  /** Number of activities in viewport */
  count: number;
}

/**
 * Hook for querying activities within a map viewport.
 * Uses R-tree spatial index in Rust for fast queries.
 */
export function useViewportActivities(bounds: Bounds | null): UseViewportActivitiesResult {
  const [activityIds, setActivityIds] = useState<string[]>([]);

  useEffect(() => {
    if (bounds) {
      const engine = getRouteEngine();
      const ids = engine
        ? engine.queryViewport(bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng)
        : [];
      setActivityIds(ids);
    } else {
      setActivityIds([]);
    }
  }, [bounds?.minLat, bounds?.maxLat, bounds?.minLng, bounds?.maxLng]);

  return {
    activityIds,
    count: activityIds.length,
  };
}

interface UseConsensusRouteResult {
  /** Consensus route points [{ lat, lng }, ...] or null if not available */
  points: Array<{ lat: number; lng: number }> | null;
  /** Whether the consensus is being computed */
  isLoading: boolean;
}

/**
 * Hook for getting the consensus (representative) route for a group.
 */
export function useConsensusRoute(groupId: string | null): UseConsensusRouteResult {
  const [points, setPoints] = useState<Array<{
    lat: number;
    lng: number;
  }> | null>(null);
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
  const group = useMemo(() => {
    if (!groupId) return null;

    const engine = getRouteEngine();
    if (!engine) return null;

    try {
      return engine.getGroupById(groupId);
    } catch {
      return null;
    }
  }, [groupId]);

  return { group };
}

interface UseSectionPolylineResult {
  /** Section polyline as RoutePoints (lat/lng), or empty array if not found */
  polyline: Array<{ lat: number; lng: number }>;
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
