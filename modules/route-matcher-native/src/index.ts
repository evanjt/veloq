/**
 * Route Matcher Native Module
 *
 * Auto-generated Turbo Module bindings via uniffi-bindgen-react-native.
 * Provides high-performance route matching, section detection, and heatmap generation.
 */

// Import the Turbo Module to install JSI bindings
import NativeVeloq from "./NativeVeloq";

// Install the Rust crate into the JS runtime (installs NativeTracematch on globalThis)
const installed = NativeVeloq.installRustCrate();
if (!installed) {
  console.warn(
    "[RouteMatcher] Failed to install Rust crate. Native functions may not work.",
  );
}

// Re-export all generated types and functions
export * from "./generated/tracematch";

// Import generated functions for the routeEngine compatibility layer
import {
  persistentEngineInit,
  persistentEngineIsInitialized,
  persistentEngineClear,
  persistentEngineAddActivities,
  persistentEngineGetActivityIds,
  persistentEngineGetActivityCount,
  persistentEngineRemoveActivities,
  persistentEngineCleanupOldActivities,
  persistentEngineMarkForRecomputation,
  persistentEngineStartSectionDetection,
  persistentEnginePollSections,
  persistentEngineCancelSectionDetection,
  persistentEngineGetGroupsJson,
  persistentEngineGetSectionsJson,
  persistentEngineGetAllActivityBoundsJson,
  persistentEngineSetRouteName,
  persistentEngineSetSectionName,
  persistentEngineGetRouteName,
  persistentEngineGetSectionName,
  persistentEngineGetAllRouteNamesJson,
  persistentEngineGetAllSectionNamesJson,
  persistentEngineGetGpsTrack,
  persistentEngineGetConsensusRoute,
  persistentEngineGetRoutePerformancesJson,
  persistentEngineSetActivityMetrics,
  persistentEngineQueryViewport,
  persistentEngineGetStats,
  persistentEngineGetCustomSectionsJson,
  persistentEngineAddCustomSection,
  persistentEngineRemoveCustomSection,
  persistentEngineMatchCustomSection,
  persistentEngineGetCustomSectionMatches,
  persistentEngineExtractSectionTrace,
  ffiDetectSectionsMultiscale,
  defaultScalePresets,
  fetchActivityMaps,
  type PersistentEngineStats,
  type ActivityMetrics,
  type GpsPoint,
  type RouteGroup,
  type FrequentSection,
  type FfiActivityMapResult,
  type CustomSection,
  type CustomSectionMatch,
} from "./generated/tracematch";

// For backward compatibility, also export the module initialization status
export function isRouteMatcherInitialized(): boolean {
  return installed;
}

/**
 * Simple point type with lat/lng (used by app code).
 */
export interface RoutePoint {
  lat: number;
  lng: number;
}

/**
 * Convert flat coordinate array to GpsPoint array.
 * @param flatCoords - Flat array [lat1, lng1, lat2, lng2, ...]
 * @returns Array of GpsPoint objects
 */
export function flatCoordsToPoints(flatCoords: number[]): GpsPoint[] {
  const points: GpsPoint[] = [];
  for (let i = 0; i < flatCoords.length - 1; i += 2) {
    points.push({
      latitude: flatCoords[i],
      longitude: flatCoords[i + 1],
      elevation: undefined,
    });
  }
  return points;
}

/**
 * Convert GpsPoint array to RoutePoint array (lat/lng format).
 */
export function gpsPointsToRoutePoints(points: GpsPoint[]): RoutePoint[] {
  return points.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
}

/**
 * Convert RoutePoint array to GpsPoint array (latitude/longitude format).
 */
export function routePointsToGpsPoints(points: RoutePoint[]): GpsPoint[] {
  return points.map((p) => ({
    latitude: p.lat,
    longitude: p.lng,
    elevation: undefined,
  }));
}

/**
 * Alias for backward compatibility.
 */
export const detectSectionsMultiscale = ffiDetectSectionsMultiscale;
export const getDefaultScalePresets = defaultScalePresets;

/**
 * Progress event from Rust HTTP fetch operations.
 */
export interface FetchProgressEvent {
  completed: number;
  total: number;
}

/**
 * Add a listener for fetch progress events.
 * Note: Progress events are not currently supported with uniffi-bindgen-react-native.
 * This is a stub that returns a no-op unsubscribe function.
 */
export function addFetchProgressListener(
  _callback: (event: FetchProgressEvent) => void,
): { remove: () => void } {
  console.warn(
    "[RouteMatcher] Progress events not supported in uniffi bindings. Use fetchActivityMaps without progress.",
  );
  return { remove: () => {} };
}

/**
 * Alias for EngineStats - backward compatibility.
 */
export type EngineStats = PersistentEngineStats;

/**
 * Fetch activity maps with progress reporting.
 * Note: Progress callback is not currently supported with uniffi-bindgen-react-native.
 * Falls back to regular fetchActivityMaps.
 */
export async function fetchActivityMapsWithProgress(
  apiKey: string,
  activityIds: string[],
  _onProgress?: (event: FetchProgressEvent) => void,
): Promise<FfiActivityMapResult[]> {
  // Progress not supported - just call the regular function
  return fetchActivityMaps(apiKey, activityIds);
}

/**
 * RouteEngineClient - Backward compatibility layer for existing app code.
 * Wraps the generated persistent engine functions with the old API.
 */
class RouteEngineClient {
  private static instance: RouteEngineClient;
  private listeners: Map<string, Set<() => void>> = new Map();
  private initialized = false;
  private dbPath: string | null = null;

  private constructor() {}

  static getInstance(): RouteEngineClient {
    if (!this.instance) {
      this.instance = new RouteEngineClient();
    }
    return this.instance;
  }

  /**
   * Initialize the engine with a database path for persistent storage.
   */
  initWithPath(dbPath: string): boolean {
    if (this.initialized && this.dbPath === dbPath) return true;
    const result = persistentEngineInit(dbPath);
    if (result) {
      this.initialized = true;
      this.dbPath = dbPath;
    }
    return result;
  }

  /**
   * Check if the engine is initialized.
   */
  isInitialized(): boolean {
    return this.initialized || persistentEngineIsInitialized();
  }

  /**
   * Check if the engine is in persistent mode.
   */
  isPersistent(): boolean {
    return this.dbPath !== null;
  }

  /**
   * Clear all engine state.
   */
  clear(): void {
    persistentEngineClear();
    this.notify("activities");
    this.notify("groups");
    this.notify("sections");
    this.notify("syncReset");
  }

  /**
   * Add activities from flat coordinate buffers.
   */
  async addActivities(
    activityIds: string[],
    allCoords: number[],
    offsets: number[],
    sportTypes: string[],
  ): Promise<void> {
    persistentEngineAddActivities(activityIds, allCoords, offsets, sportTypes);
    this.notify("activities");
  }

  /**
   * Get all activity IDs in the engine.
   */
  getActivityIds(): string[] {
    return persistentEngineGetActivityIds();
  }

  /**
   * Get the number of activities.
   */
  getActivityCount(): number {
    return persistentEngineGetActivityCount();
  }

  /**
   * Remove activities from the engine.
   */
  removeActivities(activityIds: string[]): void {
    persistentEngineRemoveActivities(activityIds);
    this.notify("activities");
  }

  /**
   * Cleanup old activities.
   */
  cleanupOldActivities(retentionDays: number): number {
    const deleted = persistentEngineCleanupOldActivities(retentionDays);
    if (deleted > 0) {
      this.notify("activities");
      this.notify("groups");
      this.notify("sections");
    }
    return deleted;
  }

  /**
   * Mark for recomputation.
   */
  markForRecomputation(): void {
    persistentEngineMarkForRecomputation();
  }

  /**
   * Start section detection.
   */
  startSectionDetection(sportFilter?: string): boolean {
    return persistentEngineStartSectionDetection(sportFilter);
  }

  /**
   * Poll section detection status.
   */
  pollSectionDetection(): string {
    return persistentEnginePollSections();
  }

  /**
   * Cancel section detection.
   */
  cancelSectionDetection(): void {
    persistentEngineCancelSectionDetection();
  }

  /**
   * Get groups as JSON.
   */
  getGroupsJson(): string {
    return persistentEngineGetGroupsJson();
  }

  /**
   * Get groups parsed from JSON.
   */
  getGroups(): RouteGroup[] {
    const json = persistentEngineGetGroupsJson();
    return json ? JSON.parse(json) : [];
  }

  /**
   * Get sections as JSON.
   */
  getSectionsJson(): string {
    return persistentEngineGetSectionsJson();
  }

  /**
   * Get sections parsed from JSON.
   */
  getSections(): FrequentSection[] {
    const json = persistentEngineGetSectionsJson();
    return json ? JSON.parse(json) : [];
  }

  /**
   * Get all activity bounds.
   */
  getAllActivityBounds(): Map<
    string,
    { minLat: number; maxLat: number; minLng: number; maxLng: number }
  > {
    const json = persistentEngineGetAllActivityBoundsJson();
    if (!json) return new Map();
    const obj = JSON.parse(json);
    return new Map(Object.entries(obj));
  }

  /**
   * Set route name.
   */
  setRouteName(routeId: string, name: string): void {
    persistentEngineSetRouteName(routeId, name);
    this.notify("groups");
  }

  /**
   * Set section name.
   */
  setSectionName(sectionId: string, name: string): void {
    persistentEngineSetSectionName(sectionId, name);
    this.notify("sections");
  }

  /**
   * Get route name.
   */
  getRouteName(routeId: string): string {
    return persistentEngineGetRouteName(routeId);
  }

  /**
   * Get section name.
   */
  getSectionName(sectionId: string): string {
    return persistentEngineGetSectionName(sectionId);
  }

  /**
   * Get GPS track for an activity.
   * Returns flat array of coordinates [lat1, lng1, lat2, lng2, ...]
   */
  getGpsTrack(activityId: string): GpsPoint[] {
    const flatCoords = persistentEngineGetGpsTrack(activityId);
    return flatCoordsToPoints(flatCoords);
  }

  /**
   * Get consensus route for a group.
   * Returns flat array of coordinates [lat1, lng1, lat2, lng2, ...]
   */
  getConsensusRoute(groupId: string): GpsPoint[] {
    const flatCoords = persistentEngineGetConsensusRoute(groupId);
    return flatCoordsToPoints(flatCoords);
  }

  /**
   * Alias for getConsensusRoute (backward compatibility).
   */
  getConsensusRoutePoints(groupId: string): GpsPoint[] {
    return this.getConsensusRoute(groupId);
  }

  /**
   * Get route performances.
   */
  getRoutePerformances(
    routeGroupId: string,
    currentActivityId: string,
  ): string {
    return persistentEngineGetRoutePerformancesJson(
      routeGroupId,
      currentActivityId,
    );
  }

  /**
   * Get section performances (alias for route performances).
   */
  getSectionPerformances(sectionId: string): string {
    return persistentEngineGetRoutePerformancesJson(sectionId, "");
  }

  /**
   * Set activity metrics.
   */
  setActivityMetrics(metrics: ActivityMetrics[]): void {
    persistentEngineSetActivityMetrics(metrics);
  }

  /**
   * Query activities in viewport.
   */
  queryViewport(
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number,
  ): string[] {
    return persistentEngineQueryViewport(minLat, maxLat, minLng, maxLng);
  }

  /**
   * Get engine stats.
   */
  getStats(): PersistentEngineStats | undefined {
    return persistentEngineGetStats();
  }

  /**
   * Get custom sections.
   */
  getCustomSections(): CustomSection[] {
    const json = persistentEngineGetCustomSectionsJson();
    return json ? JSON.parse(json) : [];
  }

  /**
   * Add a custom section.
   * Accepts either a CustomSection object or JSON string.
   */
  addCustomSection(section: CustomSection | string): boolean {
    const sectionJson =
      typeof section === "string" ? section : JSON.stringify(section);
    const result = persistentEngineAddCustomSection(sectionJson);
    this.notify("sections");
    return result;
  }

  /**
   * Remove a custom section.
   */
  removeCustomSection(sectionId: string): boolean {
    const result = persistentEngineRemoveCustomSection(sectionId);
    this.notify("sections");
    return result;
  }

  /**
   * Get custom section matches.
   */
  getCustomSectionMatches(sectionId: string): CustomSectionMatch[] {
    const json = persistentEngineGetCustomSectionMatches(sectionId);
    return json ? JSON.parse(json) : [];
  }

  /**
   * Match a custom section against activities.
   */
  matchCustomSection(
    sectionId: string,
    activityIds: string[],
  ): CustomSectionMatch[] {
    const json = persistentEngineMatchCustomSection(sectionId, activityIds);
    return json ? JSON.parse(json) : [];
  }

  /**
   * Extract section trace from an activity.
   */
  extractSectionTrace(
    activityId: string,
    sectionPolylineJson: string,
  ): GpsPoint[] {
    const flatCoords = persistentEngineExtractSectionTrace(
      activityId,
      sectionPolylineJson,
    );
    return flatCoordsToPoints(flatCoords);
  }

  /**
   * Subscribe to engine events.
   */
  subscribe(event: string, callback: () => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  /**
   * Notify listeners of an event.
   */
  private notify(event: string): void {
    this.listeners.get(event)?.forEach((cb) => cb());
  }
}

// Export the singleton instance for backward compatibility
export const routeEngine = RouteEngineClient.getInstance();
