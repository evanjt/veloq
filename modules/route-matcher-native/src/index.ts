/**
 * Route Matcher Native Module
 *
 * Auto-generated Turbo Module bindings via uniffi-bindgen-react-native.
 * Provides high-performance route matching, section detection, and heatmap generation.
 */

// Import the Turbo Module to install JSI bindings
import NativeVeloq from "./NativeVeloq";
import { validateCustomSection } from "@/lib/validation/schemas";

// Install the Rust crate into the JS runtime (installs NativeTracematch on globalThis)
const installed = NativeVeloq.installRustCrate();
if (!installed && __DEV__) {
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
  fetchActivityMapsWithProgress as generatedFetchWithProgress,
  type FetchProgressCallback,
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
 * Maximum allowed length for user-provided names (route names, section names).
 */
const MAX_NAME_LENGTH = 255;

/**
 * Regular expression to detect control characters (except common whitespace).
 * Allows: space, tab, newline, carriage return
 * Blocks: null, bell, backspace, form feed, vertical tab, escape, etc.
 */
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Safely parse JSON with error handling.
 * Returns the fallback value if parsing fails or input is null/undefined.
 *
 * @param json - The JSON string to parse
 * @param fallback - The fallback value to return on error
 * @returns The parsed value or fallback
 */
function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (json === null || json === undefined || json === "") {
    return fallback;
  }
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    if (__DEV__) {
      console.error(
        "[RouteMatcher] JSON parse error:",
        error instanceof Error ? error.message : String(error),
      );
    }
    return fallback;
  }
}

/**
 * Validate a user-provided name string.
 * Throws an error if the name is invalid.
 *
 * @param name - The name to validate
 * @param fieldName - The field name for error messages (e.g., "route name")
 * @throws Error if validation fails
 */
function validateName(name: string, fieldName: string): void {
  if (typeof name !== "string") {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid ${fieldName}: exceeds maximum length of ${MAX_NAME_LENGTH} characters`,
    );
  }
  if (CONTROL_CHAR_REGEX.test(name)) {
    throw new Error(
      `Invalid ${fieldName}: contains disallowed control characters`,
    );
  }
}

/**
 * Validate a user-provided ID string.
 * Throws an error if the ID is invalid.
 *
 * @param id - The ID to validate
 * @param fieldName - The field name for error messages (e.g., "route ID")
 * @throws Error if validation fails
 */
function validateId(id: string, fieldName: string): void {
  if (typeof id !== "string") {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (id.length === 0) {
    throw new Error(`Invalid ${fieldName}: cannot be empty`);
  }
  if (id.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid ${fieldName}: exceeds maximum length of ${MAX_NAME_LENGTH} characters`,
    );
  }
  if (CONTROL_CHAR_REGEX.test(id)) {
    throw new Error(
      `Invalid ${fieldName}: contains disallowed control characters`,
    );
  }
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
 * @deprecated Use fetchActivityMapsWithProgress with onProgress callback instead.
 * This global listener approach is no longer needed - pass callback directly to fetch function.
 */
export function addFetchProgressListener(
  _callback: (event: FetchProgressEvent) => void,
): { remove: () => void } {
  if (__DEV__) {
    console.warn(
      "[RouteMatcher] addFetchProgressListener is deprecated. Use fetchActivityMapsWithProgress with onProgress callback instead.",
    );
  }
  return { remove: () => {} };
}

/**
 * Alias for EngineStats - backward compatibility.
 */
export type EngineStats = PersistentEngineStats;

/**
 * Fetch activity maps with progress reporting.
 * Uses the Rust callback interface for real-time progress updates.
 *
 * @param authHeader - Pre-formatted Authorization header value:
 *   - For API key auth: "Basic {base64(API_KEY:key)}"
 *   - For OAuth: "Bearer {access_token}"
 */
export async function fetchActivityMapsWithProgress(
  authHeader: string,
  activityIds: string[],
  onProgress?: (event: FetchProgressEvent) => void,
): Promise<FfiActivityMapResult[]> {
  if (!onProgress) {
    // No progress callback - use regular function
    return fetchActivityMaps(authHeader, activityIds);
  }

  // Create callback adapter that conforms to FetchProgressCallback interface
  const callback: FetchProgressCallback = {
    onProgress: (completed: number, total: number) => {
      onProgress({ completed, total });
    },
  };

  // Call the generated function with callback
  return generatedFetchWithProgress(authHeader, activityIds, callback);
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
    // Notify groups so UI can refresh route counts (groups are computed lazily)
    this.notify("groups");
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
   * When detection completes, automatically notifies 'sections' subscribers.
   */
  pollSectionDetection(): string {
    const status = persistentEnginePollSections();
    // Notify subscribers when section detection completes
    if (status === "complete") {
      this.notify("sections");
    }
    return status;
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
   * Transforms snake_case keys from Rust serde to camelCase expected by TypeScript.
   */
  getGroups(): RouteGroup[] {
    const json = persistentEngineGetGroupsJson();
    const rawGroups = safeJsonParse<Record<string, unknown>[]>(json, []);
    // Transform snake_case to camelCase (Rust serde uses snake_case by default)
    return rawGroups.map((g: Record<string, unknown>) => ({
      groupId: (g.group_id ?? g.groupId) as string,
      representativeId: (g.representative_id ?? g.representativeId) as string,
      activityIds: (g.activity_ids ?? g.activityIds ?? []) as string[],
      sportType: (g.sport_type ?? g.sportType) as string,
      bounds: g.bounds as RouteGroup["bounds"],
      customName: (g.custom_name ?? g.customName) as string | undefined,
      bestTime: (g.best_time ?? g.bestTime) as number | undefined,
      avgTime: (g.avg_time ?? g.avgTime) as number | undefined,
      bestPace: (g.best_pace ?? g.bestPace) as number | undefined,
      bestActivityId: (g.best_activity_id ?? g.bestActivityId) as string | undefined,
    }));
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
    return safeJsonParse<FrequentSection[]>(json, []);
  }

  /**
   * Get all activity bounds.
   * Rust returns array of {id, bounds: [[minLat, minLng], [maxLat, maxLng]], activity_type, distance}
   */
  getAllActivityBounds(): Map<
    string,
    { minLat: number; maxLat: number; minLng: number; maxLng: number }
  > {
    const json = persistentEngineGetAllActivityBoundsJson();
    // Rust returns an array, not an object
    interface RustBoundsInfo {
      id: string;
      bounds: [[number, number], [number, number]]; // [[minLat, minLng], [maxLat, maxLng]]
      activity_type: string;
      distance: number;
    }
    const arr = safeJsonParse<RustBoundsInfo[]>(json, []);
    const result = new Map<string, { minLat: number; maxLat: number; minLng: number; maxLng: number }>();
    for (const item of arr) {
      result.set(item.id, {
        minLat: item.bounds[0][0],
        minLng: item.bounds[0][1],
        maxLat: item.bounds[1][0],
        maxLng: item.bounds[1][1],
      });
    }
    return result;
  }

  /**
   * Set route name.
   * @throws Error if routeId or name fails validation
   */
  setRouteName(routeId: string, name: string): void {
    validateId(routeId, "route ID");
    validateName(name, "route name");
    persistentEngineSetRouteName(routeId, name);
    this.notify("groups");
  }

  /**
   * Set section name.
   * @throws Error if sectionId or name fails validation
   */
  setSectionName(sectionId: string, name: string): void {
    validateId(sectionId, "section ID");
    validateName(name, "section name");
    persistentEngineSetSectionName(sectionId, name);
    this.notify("sections");
  }

  /**
   * Get route name.
   */
  getRouteName(routeId: string): string {
    validateId(routeId, "route ID");
    return persistentEngineGetRouteName(routeId);
  }

  /**
   * Get section name.
   */
  getSectionName(sectionId: string): string {
    validateId(sectionId, "section ID");
    return persistentEngineGetSectionName(sectionId);
  }

  /**
   * Get GPS track for an activity.
   * Returns flat array of coordinates [lat1, lng1, lat2, lng2, ...]
   */
  getGpsTrack(activityId: string): GpsPoint[] {
    validateId(activityId, "activity ID");
    const flatCoords = persistentEngineGetGpsTrack(activityId);
    return flatCoordsToPoints(flatCoords);
  }

  /**
   * Get consensus route for a group.
   * Returns flat array of coordinates [lat1, lng1, lat2, lng2, ...]
   */
  getConsensusRoute(groupId: string): GpsPoint[] {
    validateId(groupId, "group ID");
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
    validateId(routeGroupId, "route group ID");
    // currentActivityId can be empty string to get all performances
    if (currentActivityId !== "") {
      validateId(currentActivityId, "activity ID");
    }
    return persistentEngineGetRoutePerformancesJson(
      routeGroupId,
      currentActivityId,
    );
  }

  /**
   * Get section performances with accurate time-based calculations.
   * Uses time streams to calculate actual traversal times for each section lap.
   *
   * Note: FFI function not yet implemented in Rust - returns empty string to trigger fallback.
   */
  getSectionPerformances(_sectionId: string): string {
    // FFI function persistentEngineGetSectionPerformancesJson not available
    // Return empty string so callers use their fallback logic
    return "";
  }

  /**
   * Set activity metrics.
   */
  setActivityMetrics(metrics: ActivityMetrics[]): void {
    persistentEngineSetActivityMetrics(metrics);
  }

  /**
   * Set time streams for activities.
   * Time streams are cumulative seconds at each GPS point, used for section performance calculations.
   * @param streams - Array of { activityId, times } objects where times is cumulative seconds
   *
   * Note: FFI function not yet implemented in Rust - this is a no-op.
   */
  setTimeStreams(_streams: Array<{ activityId: string; times: number[] }>): void {
    // FFI function persistentEngineSetTimeStreamsFlat not available
    // No-op until Rust implementation is added
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
    return safeJsonParse<CustomSection[]>(json, []);
  }

  /**
   * Add a custom section.
   * Accepts either a CustomSection object or JSON string.
   * Validates the section data including size limits before passing to Rust.
   * @throws Error if validation fails (invalid fields, size > 100KB, etc.)
   */
  addCustomSection(section: CustomSection | string): boolean {
    // Validate the section data (handles both object and JSON string input)
    // This throws descriptive errors if validation fails
    const validated = validateCustomSection(section);
    const sectionJson = JSON.stringify(validated);
    const result = persistentEngineAddCustomSection(sectionJson);
    this.notify("sections");
    return result;
  }

  /**
   * Remove a custom section.
   */
  removeCustomSection(sectionId: string): boolean {
    validateId(sectionId, "section ID");
    const result = persistentEngineRemoveCustomSection(sectionId);
    this.notify("sections");
    return result;
  }

  /**
   * Get custom section matches.
   */
  getCustomSectionMatches(sectionId: string): CustomSectionMatch[] {
    validateId(sectionId, "section ID");
    const json = persistentEngineGetCustomSectionMatches(sectionId);
    return safeJsonParse<CustomSectionMatch[]>(json, []);
  }

  /**
   * Match a custom section against activities.
   */
  matchCustomSection(
    sectionId: string,
    activityIds: string[],
  ): CustomSectionMatch[] {
    validateId(sectionId, "section ID");
    const json = persistentEngineMatchCustomSection(sectionId, activityIds);
    return safeJsonParse<CustomSectionMatch[]>(json, []);
  }

  /**
   * Extract section trace from an activity.
   */
  extractSectionTrace(
    activityId: string,
    sectionPolylineJson: string,
  ): GpsPoint[] {
    validateId(activityId, "activity ID");
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
