/**
 * React hooks for the Rust Route Engine.
 *
 * These hooks provide reactive access to route data managed by the Rust engine.
 * State lives in Rust, eliminating FFI overhead for ongoing operations.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { RouteGroup, FrequentSection, EngineStats } from 'route-matcher-native';

// ============================================================================
// useRouteEngine - Main hook for engine access
// ============================================================================

interface UseRouteEngineResult {
  /** Whether the engine is initialized */
  isReady: boolean;
  /** Number of activities in the engine */
  activityCount: number;
  /** Initialize the engine (call once at app startup) */
  init: () => void;
  /** Clear all engine state */
  clear: () => void;
}

/**
 * Main hook for route engine lifecycle management.
 * Initialize once at app startup, typically in the root layout.
 *
 * @example
 * ```tsx
 * function RootLayout() {
 *   const { init, isReady } = useRouteEngine();
 *
 *   useEffect(() => {
 *     init();
 *   }, [init]);
 *
 *   if (!isReady) return <Loading />;
 *   return <App />;
 * }
 * ```
 */
export function useRouteEngine(): UseRouteEngineResult {
  const [isReady, setIsReady] = useState(false);
  const [activityCount, setActivityCount] = useState(0);

  const init = useCallback(() => {
    const engine = getRouteEngine();
    if (!engine) return;
    engine.init();
    setIsReady(true);
    setActivityCount(engine.getActivityCount());
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

  return { isReady, activityCount, init, clear };
}

// ============================================================================
// useEngineGroups - Access route groups from engine
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
  /** Refresh groups from engine */
  refresh: () => void;
}

/**
 * Hook for accessing route groups from the Rust engine.
 * Groups are computed lazily and cached in Rust.
 *
 * @example
 * ```tsx
 * function RoutesList() {
 *   const { groups, refresh } = useEngineGroups({ minActivities: 2 });
 *
 *   return (
 *     <FlatList
 *       data={groups}
 *       renderItem={({ item }) => <RouteCard group={item} />}
 *       onRefresh={refresh}
 *     />
 *   );
 * }
 * ```
 */
export function useEngineGroups(options: UseEngineGroupsOptions = {}): UseEngineGroupsResult {
  const { minActivities = 2, sortBy = 'count' } = options;

  const [groups, setGroups] = useState<RouteGroup[]>([]);

  const refresh = useCallback(() => {
    try {
      const engine = getRouteEngine();
      const allGroups = engine ? engine.getGroups() : [];
      setGroups(allGroups || []);
    } catch (e) {
      console.error('[useEngineGroups] Error getting groups:', e);
      setGroups([]);
    }
  }, []);

  // Subscribe to group changes
  useEffect(() => {
    refresh();
    const engine = getRouteEngine();
    if (!engine) return;
    const unsubscribe = engine.subscribe('groups', refresh);
    return unsubscribe;
  }, [refresh]);

  // Filter and sort
  const result = useMemo(() => {
    let filtered = groups.filter((g) => g.activityIds.length >= minActivities);

    if (sortBy === 'count') {
      filtered.sort((a, b) => b.activityIds.length - a.activityIds.length);
    } else {
      filtered.sort((a, b) => a.groupId.localeCompare(b.groupId));
    }

    return {
      groups: filtered,
      totalCount: groups.length,
      refresh,
    };
  }, [groups, minActivities, sortBy, refresh]);

  return result;
}

// ============================================================================
// useEngineSections - Access frequent sections from engine
// ============================================================================

interface UseEngineSectionsOptions {
  /** Filter by sport type */
  sportType?: string;
  /** Minimum visit count */
  minVisits?: number;
}

interface UseEngineSectionsResult {
  /** List of frequent sections */
  sections: FrequentSection[];
  /** Total number of sections */
  totalCount: number;
  /** Refresh sections from engine */
  refresh: () => void;
}

/**
 * Hook for accessing frequent sections from the Rust engine.
 * Sections are detected lazily and cached in Rust.
 *
 * @example
 * ```tsx
 * function SectionsList() {
 *   const { sections } = useEngineSections({ sportType: 'Ride', minVisits: 3 });
 *
 *   return sections.map(section => (
 *     <SectionCard key={section.id} section={section} />
 *   ));
 * }
 * ```
 */
export function useEngineSections(options: UseEngineSectionsOptions = {}): UseEngineSectionsResult {
  const { sportType, minVisits = 1 } = options;

  const [sections, setSections] = useState<FrequentSection[]>([]);

  const refresh = useCallback(() => {
    const engine = getRouteEngine();
    const allSections = engine ? engine.getSections() : [];
    setSections(allSections);
  }, []);

  // Subscribe to section changes
  useEffect(() => {
    refresh();
    const engine = getRouteEngine();
    if (!engine) return;
    const unsubscribe = engine.subscribe('sections', refresh);
    return unsubscribe;
  }, [refresh]);

  // Filter
  const result = useMemo(() => {
    let filtered = sections;

    if (sportType) {
      filtered = filtered.filter((s) => s.sportType === sportType);
    }

    filtered = filtered.filter((s) => s.visitCount >= minVisits);

    return {
      sections: filtered,
      totalCount: sections.length,
      refresh,
    };
  }, [sections, sportType, minVisits, refresh]);

  return result;
}

// ============================================================================
// useViewportActivities - Spatial query for visible activities
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
 *
 * @example
 * ```tsx
 * function MapView() {
 *   const [bounds, setBounds] = useState<Bounds | null>(null);
 *   const { activityIds } = useViewportActivities(bounds);
 *
 *   return (
 *     <Map
 *       onRegionChange={region => setBounds(regionToBounds(region))}
 *     >
 *       {activityIds.map(id => <ActivityMarker key={id} activityId={id} />)}
 *     </Map>
 *   );
 * }
 * ```
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

// ============================================================================
// useEngineStats - Engine statistics for debugging
// ============================================================================

/**
 * Hook for monitoring engine statistics.
 * Useful for debugging and performance monitoring.
 *
 * @example
 * ```tsx
 * function DebugPanel() {
 *   const stats = useEngineStats();
 *
 *   return (
 *     <View>
 *       <Text>Activities: {stats.activityCount}</Text>
 *       <Text>Groups: {stats.groupCount}</Text>
 *       <Text>Sections: {stats.sectionCount}</Text>
 *     </View>
 *   );
 * }
 * ```
 */
export function useEngineStats(): EngineStats {
  const [stats, setStats] = useState<EngineStats>({
    activityCount: 0,
    signatureCount: 0,
    groupCount: 0,
    sectionCount: 0,
    cachedConsensusCount: 0,
  });

  const refresh = useCallback(() => {
    const engine = getRouteEngine();
    if (engine) setStats(engine.getStats());
  }, []);

  // Refresh on any engine change
  useEffect(() => {
    refresh();
    const engine = getRouteEngine();
    if (!engine) return;
    const unsub1 = engine.subscribe('activities', refresh);
    const unsub2 = engine.subscribe('groups', refresh);
    const unsub3 = engine.subscribe('sections', refresh);
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [refresh]);

  return stats;
}

// ============================================================================
// useConsensusRoute - Get consensus route for a group
// ============================================================================

interface UseConsensusRouteResult {
  /** Consensus route points [{ lat, lng }, ...] or null if not available */
  points: Array<{ lat: number; lng: number }> | null;
  /** Whether the consensus is being computed */
  isLoading: boolean;
}

/**
 * Hook for getting the consensus (representative) route for a group.
 *
 * @example
 * ```tsx
 * function RouteDetail({ groupId }: { groupId: string }) {
 *   const { points } = useConsensusRoute(groupId);
 *
 *   if (!points) return <Loading />;
 *
 *   return <Polyline coordinates={points} />;
 * }
 * ```
 */
export function useConsensusRoute(groupId: string | null): UseConsensusRouteResult {
  const [points, setPoints] = useState<Array<{ lat: number; lng: number }> | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!groupId) {
      setPoints(null);
      return;
    }

    setIsLoading(true);
    const engine = getRouteEngine();
    const gpsPoints = engine ? engine.getConsensusRoutePoints(groupId) : [];

    if (gpsPoints.length > 0) {
      setPoints(gpsPoints.map((p) => ({ lat: p.latitude, lng: p.longitude })));
    } else {
      setPoints(null);
    }
    setIsLoading(false);
  }, [groupId]);

  return { points, isLoading };
}
