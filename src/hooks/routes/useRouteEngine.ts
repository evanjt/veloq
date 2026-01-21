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
import { getRouteEngine } from '@/lib/native/routeEngine';
import { generateSectionName } from '@/lib/utils/sectionNaming';
import {
  gpsPointsToRoutePoints,
  type RouteGroup,
  type FrequentSection as NativeFrequentSection,
  type PersistentEngineStats,
  type SectionSummary,
  type GroupSummary,
} from 'route-matcher-native';
import type { FrequentSection } from '@/types';

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
   *
   * Security: Validates that the provided path is within the app's document directory
   * to prevent path traversal attacks.
   */
  const initWithPath = useCallback((dbPath?: string): boolean => {
    const engine = getRouteEngine();
    if (!engine) return false;

    const path = dbPath || getDefaultDbPath();
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
      if (__DEV__) {
        console.error('[useRouteEngine] Rejected path with traversal sequence:', normalizedPath);
      }
      return false;
    }

    // Ensure path is within the document directory
    if (!normalizedPath.startsWith(normalizedDocDir)) {
      if (__DEV__) {
        console.error('[useRouteEngine] Rejected path outside document directory:', normalizedPath);
      }
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
 * Groups are queried fresh from Rust/SQLite on each refresh (no long-term JS memory storage).
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

  // Lightweight refresh trigger - only stores a counter, not data
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = useCallback(() => {
    setRefreshTrigger((r) => r + 1);
  }, []);

  // Subscribe to group changes for updates
  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;
    const unsubscribe = engine.subscribe('groups', refresh);
    return unsubscribe;
  }, [refresh]);

  // Query fresh from Rust on each render/refresh (no useState storage of full data)
  const result = useMemo(() => {
    try {
      const engine = getRouteEngine();
      const allGroups = engine ? engine.getGroups() : [];

      let filtered = allGroups.filter((g) => g.activityIds?.length >= minActivities);

      if (sortBy === 'count') {
        filtered.sort((a, b) => (b.activityIds?.length ?? 0) - (a.activityIds?.length ?? 0));
      } else {
        filtered.sort((a, b) => a.groupId.localeCompare(b.groupId));
      }

      return {
        groups: filtered,
        totalCount: allGroups.length,
        refresh,
      };
    } catch (e) {
      if (__DEV__) {
        console.error('[useEngineGroups] Error getting groups:', e);
      }
      return {
        groups: [],
        totalCount: 0,
        refresh,
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minActivities, sortBy, refresh, refreshTrigger]);

  return result;
}

// ============================================================================
// Section Conversion Helper
// ============================================================================

/**
 * Convert native section (GpsPoint) to app section (RoutePoint).
 */
function convertNativeSectionToApp(native: NativeFrequentSection): FrequentSection {
  // Convert polyline from GpsPoint[] to RoutePoint[]
  const polyline = gpsPointsToRoutePoints(native.polyline);

  // Convert activity traces if present
  const activityTraces = native.activityTraces
    ? Object.fromEntries(
        Object.entries(native.activityTraces).map(([id, pts]) => [id, gpsPointsToRoutePoints(pts)])
      )
    : undefined;

  return {
    id: native.id,
    sportType: native.sportType,
    polyline,
    representativeActivityId: native.representativeActivityId,
    activityIds: native.activityIds,
    activityPortions: native.activityPortions,
    routeIds: native.routeIds,
    visitCount: native.visitCount,
    distanceMeters: native.distanceMeters,
    name: native.name,
    activityTraces,
    confidence: native.confidence,
    observationCount: native.observationCount,
    averageSpread: native.averageSpread,
    pointDensity: native.pointDensity,
  };
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
 * Sections are queried fresh from Rust/SQLite on each refresh (no long-term JS memory storage).
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

  // Lightweight refresh trigger - only stores a counter, not data
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = useCallback(() => {
    setRefreshTrigger((r) => r + 1);
  }, []);

  // Subscribe to section changes for updates
  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;
    const unsubscribe = engine.subscribe('sections', refresh);
    return unsubscribe;
  }, [refresh]);

  // Query fresh from Rust on each render/refresh (no useState storage of full data)
  const result = useMemo(() => {
    try {
      const engine = getRouteEngine();
      const allNativeSections = engine ? engine.getSections() : [];

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
        refresh,
      };
    } catch (e) {
      if (__DEV__) {
        console.error('[useEngineSections] Error getting sections:', e);
      }
      return {
        sections: [] as FrequentSection[],
        totalCount: 0,
        refresh,
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportType, minVisits, refresh, refreshTrigger]);

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
    gpsTrackCount: 0,
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

// ============================================================================
// Query-on-demand hooks - DO NOT store large datasets in useState
// These hooks subscribe to engine events but only store a refresh counter,
// not the actual data. Data is queried fresh on each render.
// ============================================================================

interface UseSectionSummariesOptions {
  /** Filter by sport type */
  sportType?: string;
  /** Minimum visit count */
  minVisits?: number;
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
 *
 * @example
 * ```tsx
 * function SectionsList() {
 *   const { count, summaries } = useSectionSummaries({ sportType: 'Ride', minVisits: 2 });
 *   return <FlatList data={summaries} ... />;
 * }
 * ```
 */
export function useSectionSummaries(
  options: UseSectionSummariesOptions = {}
): UseSectionSummariesResult {
  const { sportType, minVisits = 1 } = options;

  // Lightweight refresh trigger - only stores a counter, not data
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Subscribe to section changes
  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;
    const unsubscribe = engine.subscribe('sections', () => {
      setRefreshTrigger((r) => r + 1);
    });
    return unsubscribe;
  }, []);

  // Count is cheap - direct SQL COUNT query, recomputed on refresh
  const count = useMemo(() => {
    const engine = getRouteEngine();
    return engine?.getSectionCount() ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  // Query summaries fresh on each render/refresh (no useState storage)
  const summaries = useMemo((): SectionSummary[] => {
    const engine = getRouteEngine();
    if (!engine) return [];

    try {
      const rawSummaries = sportType
        ? engine.getSectionSummariesForSport(sportType)
        : engine.getSectionSummaries();

      // Apply minimum visits filter and generate display names
      return rawSummaries
        .filter((s) => s.visitCount >= minVisits)
        .map((s) => ({
          ...s,
          name: s.name || generateSectionName(s),
        }));
    } catch (e) {
      if (__DEV__) {
        console.error('[useSectionSummaries] Error getting summaries:', e);
      }
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportType, minVisits, refreshTrigger]);

  return { count, summaries };
}

interface UseSectionDetailResult {
  /** Full section data (with polyline) or null if not found */
  section: FrequentSection | null;
}

/**
 * Query-on-demand hook for a single section's full data.
 * Fetches from Rust/SQLite with LRU caching.
 * Converts GpsPoint format to RoutePoint format.
 *
 * @example
 * ```tsx
 * function SectionDetailPage({ sectionId }: { sectionId: string }) {
 *   const { section } = useSectionDetail(sectionId);
 *
 *   if (!section) return <NotFound />;
 *   return <SectionMap polyline={section.polyline} />;
 * }
 * ```
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
    } catch (e) {
      if (__DEV__) {
        console.error('[useSectionDetail] Error getting section:', sectionId, e);
      }
      return null;
    }
  }, [sectionId]);

  return { section };
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
 *
 * @example
 * ```tsx
 * function RoutesList() {
 *   const { count, summaries } = useGroupSummaries({ minActivities: 2 });
 *   return <FlatList data={summaries} ... />;
 * }
 * ```
 */
export function useGroupSummaries(options: UseGroupSummariesOptions = {}): UseGroupSummariesResult {
  const { minActivities = 2, sortBy = 'count' } = options;

  // Lightweight refresh trigger - only stores a counter, not data
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Subscribe to group changes
  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;
    const unsubscribe = engine.subscribe('groups', () => {
      setRefreshTrigger((r) => r + 1);
    });
    return unsubscribe;
  }, []);

  // Count is cheap - direct SQL COUNT query, recomputed on refresh
  const count = useMemo(() => {
    const engine = getRouteEngine();
    return engine?.getGroupCount() ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  // Query summaries fresh on each render/refresh (no useState storage)
  const summaries = useMemo((): GroupSummary[] => {
    const engine = getRouteEngine();
    if (!engine) return [];

    try {
      let rawSummaries = engine.getGroupSummaries();

      // Apply filters
      rawSummaries = rawSummaries.filter((g) => g.activityCount >= minActivities);

      // Sort
      if (sortBy === 'count') {
        rawSummaries.sort((a, b) => b.activityCount - a.activityCount);
      } else {
        rawSummaries.sort((a, b) => a.groupId.localeCompare(b.groupId));
      }

      return rawSummaries;
    } catch (e) {
      if (__DEV__) {
        console.error('[useGroupSummaries] Error getting summaries:', e);
      }
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minActivities, sortBy, refreshTrigger]);

  return { count, summaries };
}

interface UseGroupDetailResult {
  /** Full group data or null if not found */
  group: RouteGroup | null;
}

/**
 * Query-on-demand hook for a single group's full data.
 * Fetches from Rust/SQLite with LRU caching.
 *
 * @example
 * ```tsx
 * function RouteDetailPage({ groupId }: { groupId: string }) {
 *   const { group } = useGroupDetail(groupId);
 *
 *   if (!group) return <NotFound />;
 *   return <RouteInfo activityIds={group.activityIds} />;
 * }
 * ```
 */
export function useGroupDetail(groupId: string | null): UseGroupDetailResult {
  const group = useMemo(() => {
    if (!groupId) return null;

    const engine = getRouteEngine();
    if (!engine) return null;

    try {
      return engine.getGroupById(groupId);
    } catch (e) {
      if (__DEV__) {
        console.error('[useGroupDetail] Error getting group:', groupId, e);
      }
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
 *
 * @example
 * ```tsx
 * function SectionRowPreview({ sectionId }: { sectionId: string }) {
 *   const { polyline } = useSectionPolyline(sectionId);
 *   if (polyline.length === 0) return <Placeholder />;
 *   return <PolylinePreview points={polyline} />;
 * }
 * ```
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
    } catch (e) {
      if (__DEV__) {
        console.error('[useSectionPolyline] Error getting polyline:', sectionId, e);
      }
      return [];
    }
  }, [sectionId]);

  return { polyline };
}
