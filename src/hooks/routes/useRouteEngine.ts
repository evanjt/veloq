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
import { InteractionManager } from 'react-native';
// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { RouteGroup, FrequentSection, PersistentEngineStats } from 'route-matcher-native';

// Default database path for persistent engine
// FileSystem.documentDirectory returns a file:// URI, but SQLite needs a plain path
const getDefaultDbPath = () => {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return null;
  // Strip file:// prefix if present for SQLite compatibility
  const plainPath = docDir.startsWith('file://') ? docDir.slice(7) : docDir;
  return `${plainPath}routes.db`;
};

// ============================================================================
// useRouteEngine - Main hook for engine access
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
 *
 * @example
 * ```tsx
 * function RootLayout() {
 *   const { initWithPath, isReady, isPersistent } = useRouteEngine();
 *
 *   useEffect(() => {
 *     // Initialize with persistent storage (recommended)
 *     const success = initWithPath();
 *     if (success) {
 *       console.log('Engine ready with persistent storage');
 *     }
 *   }, [initWithPath]);
 *
 *   if (!isReady) return <Loading />;
 *   return <App />;
 * }
 * ```
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

    const path = dbPath || getDefaultDbPath();
    if (!path) return false;
    const success = engine.initWithPath(path);

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

  // Subscribe to group changes - defer initial load until after animations
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      refresh();
    });
    const engine = getRouteEngine();
    if (!engine) return () => task.cancel();
    const unsubscribe = engine.subscribe('groups', refresh);
    return () => {
      task.cancel();
      unsubscribe();
    };
  }, [refresh]);

  // Filter and sort
  const result = useMemo(() => {
    let filtered = groups.filter((g) => g.activityIds?.length >= minActivities);

    if (sortBy === 'count') {
      filtered.sort((a, b) => (b.activityIds?.length ?? 0) - (a.activityIds?.length ?? 0));
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

  // Subscribe to section changes - defer initial load until after animations
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      refresh();
    });
    const engine = getRouteEngine();
    if (!engine) return () => task.cancel();
    const unsubscribe = engine.subscribe('sections', refresh);
    return () => {
      task.cancel();
      unsubscribe();
    };
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
export function useEngineStats(): PersistentEngineStats {
  const [stats, setStats] = useState<PersistentEngineStats>({
    activityCount: 0,
    signatureCacheSize: 0,
    consensusCacheSize: 0,
    groupCount: 0,
    sectionCount: 0,
    groupsDirty: false,
    sectionsDirty: false,
  });

  const refresh = useCallback(() => {
    const engine = getRouteEngine();
    const newStats = engine?.getStats();
    if (newStats) setStats(newStats);
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
