/**
 * Route Matcher Native Module
 *
 * Auto-generated Turbo Module bindings via uniffi-bindgen-react-native.
 * Provides high-performance route matching and section detection.
 */

// Import the Turbo Module to install JSI bindings
import NativeVeloqrs from './NativeVeloqrs';
import { validateCustomSection } from '@/lib/validation/schemas';

// Install the Rust crate into the JS runtime (installs NativeVeloqrs on globalThis)
const installed = NativeVeloqrs.installRustCrate();
if (!installed && __DEV__) {
  console.warn('[RouteMatcher] Failed to install Rust crate. Native functions may not work.');
}

// Re-export all generated types and functions
export * from './generated/veloqrs';

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
  persistentEngineGetSectionCount,
  persistentEngineGetGroupCount,
  persistentEngineGetSectionSummariesJson,
  persistentEngineGetSectionSummariesForSportJson,
  persistentEngineGetGroupSummariesJson,
  persistentEngineGetSectionByIdJson,
  persistentEngineGetGroupByIdJson,
  persistentEngineGetSectionPolyline,
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
  persistentEngineCreateSectionFromIndices,
  persistentEngineDetectPotentials,
  persistentEngineRemoveCustomSection,
  encodeCoordinatesToPolyline,
  decodePolylineToCoordinates,
  persistentEngineGetGpsTrackEncoded,
  persistentEngineGetSectionPolylineEncoded,
  persistentEngineMatchCustomSection,
  persistentEngineGetCustomSectionMatches,
  persistentEngineExtractSectionTrace,
  persistentEngineGetSectionPerformancesJson,
  persistentEngineSetTimeStreamsFlat,
  persistentEngineGetActivitiesMissingTimeStreams,
  persistentEngineGetAllMapActivitiesComplete,
  persistentEngineGetMapActivitiesFiltered,
  ffiDetectSectionsMultiscale,
  defaultScalePresets,
  fetchActivityMaps,
  fetchActivityMapsWithProgress as generatedFetchWithProgress,
  getDownloadProgress as ffiGetDownloadProgress,
  type FetchProgressCallback,
  type PersistentEngineStats,
  type FfiActivityMetrics,
  type FfiGpsPoint,
  type FfiRouteGroup,
  type FfiFrequentSection,
  type FfiActivityMapResult,
  type SectionSummary,
  type GroupSummary,
  type DownloadProgressResult,
  FfiSectionConfig,
  type MapActivityComplete,
} from './generated/veloqrs';

// Re-export types with shorter names for convenience
export type ActivityMetrics = FfiActivityMetrics;
export type GpsPoint = FfiGpsPoint;
export type RouteGroup = FfiRouteGroup;
export type FrequentSection = FfiFrequentSection;
export type SectionConfig = FfiSectionConfig;
// These are already exported without Ffi prefix:
export type { PersistentEngineStats, SectionSummary, GroupSummary, DownloadProgressResult, MapActivityComplete };

// For backward compatibility, also export the module initialization status
export function isRouteMatcherInitialized(): boolean {
  return installed;
}

/**
 * Progress state for section detection.
 */
export interface SectionDetectionProgress {
  /** Current phase: "loading", "building_rtrees", "finding_overlaps", "clustering", "building_sections", "postprocessing", "complete" */
  phase: string;
  /** Number of items completed in current phase */
  completed: number;
  /** Total items in current phase */
  total: number;
}

/**
 * A user-created custom section.
 * Created by selecting a portion of an activity's GPS track.
 */
export interface CustomSection {
  /** Unique section ID */
  id: string;
  /** User-defined or auto-generated name */
  name: string;
  /** GPS points defining the section */
  polyline: RoutePoint[];
  /** Start index in the source activity's GPS track */
  startIndex: number;
  /** End index in the source activity's GPS track */
  endIndex: number;
  /** Activity ID this section was created from */
  sourceActivityId: string;
  /** Sport type (e.g., "Ride", "Run") */
  sportType: string;
  /** Section length in meters */
  distanceMeters: number;
  /** ISO timestamp when the section was created */
  createdAt: string;
}

/**
 * Match result for a custom section against an activity.
 */
export interface CustomSectionMatch {
  /** Activity ID that matches this section */
  activityId: string;
  /** Start index in the activity's GPS track where section starts */
  startIndex: number;
  /** End index in the activity's GPS track where section ends */
  endIndex: number;
  /** Direction: 'same' or 'reverse' relative to section definition */
  direction: 'same' | 'reverse';
  /** Distance of the matched portion in meters */
  distanceMeters: number;
  /**
   * Extracted GPS points that are actually near the section polyline.
   * Use this for visualization instead of slicing by indices to avoid
   * "straight line" artifacts from points that deviate from the section.
   * Optional for backward compatibility - will be populated when available.
   */
  trace?: RoutePoint[];
}

/**
 * Raw potential section from Rust (uses GpsPoint polyline, not RoutePoint).
 * Caller should convert polyline using gpsPointsToRoutePoints().
 */
export interface RawPotentialSection {
  /** Unique section ID */
  id: string;
  /** Sport type ("Run", "Ride", etc.) */
  sport_type: string;
  /** GPS points defining the section (Rust format: latitude/longitude) */
  polyline: GpsPoint[];
  /** Activity IDs that traverse this potential section (1-2) */
  activity_ids: string[];
  /** Number of times traversed (1-2) */
  visit_count: number;
  /** Section length in meters */
  distance_meters: number;
  /** Confidence score (0.0-1.0) */
  confidence: number;
  /** Scale at which this was detected: "short", "medium", "long" */
  scale: string;
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
 * Convert snake_case keys to camelCase.
 * Handles both flat and nested objects/arrays.
 */
function snakeToCamel(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = snakeToCamel(value);
    }
    return result;
  }
  return obj;
}

/**
 * Check if an object has snake_case keys (indicating old Rust binary).
 * Only checks top-level keys for performance.
 */
function hasSnakeCaseKeys(obj: unknown): boolean {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.keys(obj).some((key) => key.includes('_'));
  }
  if (Array.isArray(obj) && obj.length > 0) {
    return hasSnakeCaseKeys(obj[0]);
  }
  return false;
}

/**
 * Safely parse JSON with error handling.
 * Returns the fallback value if parsing fails or input is null/undefined.
 * Automatically transforms snake_case to camelCase for backward compatibility
 * with older Rust binaries that don't have serde(rename_all = "camelCase").
 *
 * @param json - The JSON string to parse
 * @param fallback - The fallback value to return on error
 * @returns The parsed value or fallback
 */
function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (json === null || json === undefined || json === '') {
    return fallback;
  }
  try {
    const parsed = JSON.parse(json);
    // Transform snake_case to camelCase if needed (backward compat with old binaries)
    if (hasSnakeCaseKeys(parsed)) {
      return snakeToCamel(parsed) as T;
    }
    return parsed as T;
  } catch (error) {
    if (__DEV__) {
      console.error(
        '[RouteMatcher] JSON parse error:',
        error instanceof Error ? error.message : String(error)
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
  if (typeof name !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid ${fieldName}: exceeds maximum length of ${MAX_NAME_LENGTH} characters`
    );
  }
  if (CONTROL_CHAR_REGEX.test(name)) {
    throw new Error(`Invalid ${fieldName}: contains disallowed control characters`);
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
  if (typeof id !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (id.length === 0) {
    throw new Error(`Invalid ${fieldName}: cannot be empty`);
  }
  if (id.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid ${fieldName}: exceeds maximum length of ${MAX_NAME_LENGTH} characters`
    );
  }
  if (CONTROL_CHAR_REGEX.test(id)) {
    throw new Error(`Invalid ${fieldName}: contains disallowed control characters`);
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
export function addFetchProgressListener(_callback: (event: FetchProgressEvent) => void): {
  remove: () => void;
} {
  if (__DEV__) {
    console.warn(
      '[RouteMatcher] addFetchProgressListener is deprecated. Use fetchActivityMapsWithProgress with onProgress callback instead.'
    );
  }
  return { remove: () => {} };
}

/**
 * Alias for EngineStats - backward compatibility.
 */
export type EngineStats = PersistentEngineStats;

/**
 * Fetch activity maps with optional progress reporting.
 *
 * @param authHeader - Pre-formatted Authorization header value:
 *   - For API key auth: "Basic {base64(API_KEY:key)}"
 *   - For OAuth: "Bearer {access_token}"
 * @param onProgress - Optional callback for progress updates. If not provided,
 *   uses the non-callback version which is safer for React Native.
 */
export async function fetchActivityMapsWithProgress(
  authHeader: string,
  activityIds: string[],
  onProgress?: (event: FetchProgressEvent) => void
): Promise<FfiActivityMapResult[]> {
  if (!onProgress) {
    // Use non-callback version - avoids cross-thread FFI callback issues
    return fetchActivityMaps(authHeader, activityIds);
  }

  // Create callback adapter that conforms to FetchProgressCallback interface
  const callback: FetchProgressCallback = {
    onProgress: (completed: number, total: number) => {
      onProgress({ completed, total });
    },
  };

  return generatedFetchWithProgress(authHeader, activityIds, callback);
}

/**
 * Get current download progress for polling.
 *
 * Call this every 100ms during fetch operations to get smooth progress updates.
 * Avoids cross-thread FFI callback issues by using atomic counters in Rust.
 *
 * @returns Progress with completed/total/active fields
 */
export function getDownloadProgress(): DownloadProgressResult {
  return ffiGetDownloadProgress();
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
    this.notify('activities');
    this.notify('groups');
    this.notify('sections');
    this.notify('syncReset');
  }

  /**
   * Add activities from flat coordinate buffers.
   */
  async addActivities(
    activityIds: string[],
    allCoords: number[],
    offsets: number[],
    sportTypes: string[]
  ): Promise<void> {
    persistentEngineAddActivities(activityIds, allCoords, offsets, sportTypes);
    this.notify('activities');
    // Notify groups so UI can refresh route counts (groups are computed lazily)
    this.notify('groups');
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
    this.notify('activities');
  }

  /**
   * Cleanup old activities.
   */
  cleanupOldActivities(retentionDays: number): number {
    const deleted = persistentEngineCleanupOldActivities(retentionDays);
    if (deleted > 0) {
      this.notify('activities');
      this.notify('groups');
      this.notify('sections');
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
    if (status === 'complete') {
      this.notify('sections');
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
   * Get section detection progress.
   * Returns { phase, completed, total } or null if no detection running.
   * NOTE: Requires regenerating bindings after Rust rebuild: `npm run ubrn:generate`
   */
  getSectionDetectionProgress(): SectionDetectionProgress | null {
    // Import dynamically to handle case where function doesn't exist yet
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const generated = require('./generated/veloqrs');
      if (typeof generated.persistentEngineGetSectionDetectionProgress !== 'function') {
        return null;
      }
      const json = generated.persistentEngineGetSectionDetectionProgress() as string;

      if (!json || json === '{}') {
        return null;
      }
      const data = JSON.parse(json) as {
        phase?: string;
        completed?: number;
        total?: number;
      };
      if (!data.phase) {
        return null;
      }
      return {
        phase: data.phase,
        completed: data.completed ?? 0,
        total: data.total ?? 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get groups as JSON.
   */
  getGroupsJson(): string {
    return persistentEngineGetGroupsJson();
  }

  /**
   * Get groups parsed from JSON.
   * Rust now outputs camelCase directly via serde(rename_all = "camelCase").
   */
  getGroups(): RouteGroup[] {
    const json = persistentEngineGetGroupsJson();
    const groups = safeJsonParse<RouteGroup[]>(json, []);

    // Debug: Log any groups with null/undefined sportType
    if (__DEV__) {
      const invalidGroups = groups.filter((g) => g.sportType == null);
      if (invalidGroups.length > 0) {
        console.warn(
          `[RouteMatcher] ${invalidGroups.length} groups have null sportType:`,
          invalidGroups.map((g) => ({
            groupId: g.groupId,
            activityIds: g.activityIds.slice(0, 3),
            sportType: g.sportType,
          }))
        );
      }
    }

    return groups;
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

  // ========================================================================
  // Lightweight Query Methods (Query on-demand, don't cache in JS)
  // ========================================================================

  /**
   * Get section count directly from SQLite (no data loading).
   * This is O(1) and doesn't require loading sections into memory.
   */
  getSectionCount(): number {
    return persistentEngineGetSectionCount();
  }

  /**
   * Get group count directly from SQLite (no data loading).
   * This is O(1) and doesn't require loading groups into memory.
   */
  getGroupCount(): number {
    return persistentEngineGetGroupCount();
  }

  /**
   * Get lightweight section summaries without polyline data.
   * Use this for list views where you only need metadata.
   */
  getSectionSummaries(): SectionSummary[] {
    const json = persistentEngineGetSectionSummariesJson();
    return safeJsonParse<SectionSummary[]>(json, []);
  }

  /**
   * Get section summaries filtered by sport type.
   */
  getSectionSummariesForSport(sportType: string): SectionSummary[] {
    const json = persistentEngineGetSectionSummariesForSportJson(sportType);
    return safeJsonParse<SectionSummary[]>(json, []);
  }

  /**
   * Get lightweight group summaries without full activity ID lists.
   * Use this for list views where you only need metadata.
   */
  getGroupSummaries(): GroupSummary[] {
    const json = persistentEngineGetGroupSummariesJson();
    return safeJsonParse<GroupSummary[]>(json, []);
  }

  /**
   * Get a single section by ID with full data (including polyline).
   * Use this for detail pages where you need complete section data.
   */
  getSectionById(sectionId: string): FrequentSection | null {
    validateId(sectionId, 'section ID');
    const json = persistentEngineGetSectionByIdJson(sectionId);
    if (!json) return null;
    try {
      return JSON.parse(json) as FrequentSection;
    } catch {
      return null;
    }
  }

  /**
   * Get a single group by ID with full data (including activity IDs).
   * Use this for detail pages where you need complete group data.
   */
  getGroupById(groupId: string): RouteGroup | null {
    validateId(groupId, 'group ID');
    const json = persistentEngineGetGroupByIdJson(groupId);
    if (!json) return null;
    try {
      return JSON.parse(json) as RouteGroup;
    } catch {
      return null;
    }
  }

  /**
   * Get section polyline only (flat coordinates for map rendering).
   * Returns array of GpsPoint or empty array if not found.
   */
  getSectionPolyline(sectionId: string): GpsPoint[] {
    validateId(sectionId, 'section ID');
    const flatCoords = persistentEngineGetSectionPolyline(sectionId);
    // Convert flat [lat1, lng1, lat2, lng2, ...] to GpsPoint[]
    const points: GpsPoint[] = [];
    for (let i = 0; i < flatCoords.length; i += 2) {
      points.push({
        latitude: flatCoords[i],
        longitude: flatCoords[i + 1],
        elevation: undefined,
      });
    }
    return points;
  }

  /**
   * Get all activity bounds.
   * Rust returns array of {id, bounds: [[minLat, minLng], [maxLat, maxLng]], activityType, distance}
   */
  getAllActivityBounds(): Map<
    string,
    { minLat: number; maxLat: number; minLng: number; maxLng: number }
  > {
    const json = persistentEngineGetAllActivityBoundsJson();
    interface RustBoundsInfo {
      id: string;
      bounds: [[number, number], [number, number]]; // [[minLat, minLng], [maxLat, maxLng]]
      activityType: string;
      distance: number;
    }
    const arr = safeJsonParse<RustBoundsInfo[]>(json, []);

    // Debug: Log first item's raw JSON structure to verify Rust output format
    if (__DEV__ && arr.length > 0) {
      const sample = arr[0];
      console.log(
        `[RouteEngine.getAllActivityBounds] Sample raw bounds from Rust: id=${sample.id}, bounds=${JSON.stringify(sample.bounds)}`
      );
    }

    const result = new Map<
      string,
      { minLat: number; maxLat: number; minLng: number; maxLng: number }
    >();
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
   * Get all map activities with complete data.
   * Returns activities with bounds, name, date, distance, duration, sportType.
   */
  getAllMapActivitiesComplete(): MapActivityComplete[] {
    return persistentEngineGetAllMapActivitiesComplete();
  }

  /**
   * Get map activities filtered by date range and sport types.
   * All filtering happens in Rust for maximum performance.
   */
  getMapActivitiesFiltered(
    startDate: Date,
    endDate: Date,
    sportTypesArray?: string[]
  ): MapActivityComplete[] {
    const startTs = BigInt(Math.floor(startDate.getTime() / 1000));
    const endTs = BigInt(Math.floor(endDate.getTime() / 1000));
    const sportTypesJson = sportTypesArray?.length
      ? JSON.stringify(sportTypesArray)
      : '';
    return persistentEngineGetMapActivitiesFiltered(startTs, endTs, sportTypesJson);
  }

  /**
   * Set route name.
   * @throws Error if routeId or name fails validation
   */
  setRouteName(routeId: string, name: string): void {
    validateId(routeId, 'route ID');
    validateName(name, 'route name');
    persistentEngineSetRouteName(routeId, name);
    this.notify('groups');
  }

  /**
   * Set section name.
   * @throws Error if sectionId or name fails validation
   */
  setSectionName(sectionId: string, name: string): void {
    validateId(sectionId, 'section ID');
    validateName(name, 'section name');
    persistentEngineSetSectionName(sectionId, name);
    this.notify('sections');
  }

  /**
   * Get route name.
   */
  getRouteName(routeId: string): string {
    validateId(routeId, 'route ID');
    return persistentEngineGetRouteName(routeId);
  }

  /**
   * Get section name.
   */
  getSectionName(sectionId: string): string {
    validateId(sectionId, 'section ID');
    return persistentEngineGetSectionName(sectionId);
  }

  /**
   * Get all custom route names.
   * Returns a map of routeId -> customName for all routes with custom names.
   */
  getAllRouteNames(): Record<string, string> {
    const json = persistentEngineGetAllRouteNamesJson();
    return json ? JSON.parse(json) : {};
  }

  /**
   * Get all custom section names.
   * Returns a map of sectionId -> customName for all sections with custom names.
   */
  getAllSectionNames(): Record<string, string> {
    const json = persistentEngineGetAllSectionNamesJson();
    return json ? JSON.parse(json) : {};
  }

  /**
   * Get GPS track for an activity.
   * Returns flat array of coordinates [lat1, lng1, lat2, lng2, ...]
   */
  getGpsTrack(activityId: string): GpsPoint[] {
    validateId(activityId, 'activity ID');
    const flatCoords = persistentEngineGetGpsTrack(activityId);
    return flatCoordsToPoints(flatCoords);
  }

  /**
   * Get consensus route for a group.
   * Returns flat array of coordinates [lat1, lng1, lat2, lng2, ...]
   */
  getConsensusRoute(groupId: string): GpsPoint[] {
    validateId(groupId, 'group ID');
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
  getRoutePerformances(routeGroupId: string, currentActivityId: string): string {
    validateId(routeGroupId, 'route group ID');
    // currentActivityId can be empty string to get all performances
    if (currentActivityId !== '') {
      validateId(currentActivityId, 'activity ID');
    }
    return persistentEngineGetRoutePerformancesJson(routeGroupId, currentActivityId);
  }

  /**
   * Get section performances with accurate time-based calculations.
   * Uses time streams to calculate actual traversal times for each section lap.
   * Supports both engine-detected sections and custom sections.
   */
  getSectionPerformances(sectionId: string): string {
    return persistentEngineGetSectionPerformancesJson(sectionId);
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
   */
  setTimeStreams(streams: Array<{ activityId: string; times: number[] }>): void {
    if (streams.length === 0) return;

    // Convert to flat format for FFI
    const activityIds: string[] = [];
    const allTimes: number[] = [];
    const offsets: number[] = [0];

    for (const stream of streams) {
      activityIds.push(stream.activityId);
      allTimes.push(...stream.times);
      offsets.push(allTimes.length);
    }

    persistentEngineSetTimeStreamsFlat(activityIds, allTimes, offsets);
  }

  /**
   * Get activity IDs that are missing cached time streams.
   * Used to determine which activities need time streams fetched from API.
   * @param activityIds - List of activity IDs to check
   * @returns Activity IDs that don't have cached time streams (either in memory or SQLite)
   */
  getActivitiesMissingTimeStreams(activityIds: string[]): string[] {
    if (activityIds.length === 0) return [];
    return persistentEngineGetActivitiesMissingTimeStreams(activityIds);
  }

  /**
   * Query activities in viewport.
   */
  queryViewport(minLat: number, maxLat: number, minLng: number, maxLng: number): string[] {
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
    this.notify('sections');
    return result;
  }

  /**
   * Create a custom section from activity indices.
   * GPS track is loaded from SQLite internally - no coordinate transfer needed.
   * This is more efficient than addCustomSection when you have indices.
   * @returns The created CustomSection, or null on error
   */
  createSectionFromIndices(
    activityId: string,
    startIndex: number,
    endIndex: number,
    sportType: string,
    name?: string
  ): CustomSection | null {
    validateId(activityId, 'activity ID');
    const json = persistentEngineCreateSectionFromIndices(
      activityId,
      startIndex,
      endIndex,
      sportType,
      name
    );
    if (!json) return null;
    const section = safeJsonParse<CustomSection>(json, null as unknown as CustomSection);
    if (section) {
      this.notify('sections');
    }
    return section;
  }

  /**
   * Detect potential sections using GPS tracks from SQLite.
   * Single FFI call - all loading happens in Rust (no N+1 pattern).
   * Returns raw potentials with GpsPoint polylines.
   */
  detectPotentials(sportFilter?: string): RawPotentialSection[] {
    const json = persistentEngineDetectPotentials(sportFilter);
    return safeJsonParse<RawPotentialSection[]>(json, []);
  }

  /**
   * Remove a custom section.
   */
  removeCustomSection(sectionId: string): boolean {
    validateId(sectionId, 'section ID');
    const result = persistentEngineRemoveCustomSection(sectionId);
    this.notify('sections');
    return result;
  }

  /**
   * Get custom section matches.
   */
  getCustomSectionMatches(sectionId: string): CustomSectionMatch[] {
    validateId(sectionId, 'section ID');
    const json = persistentEngineGetCustomSectionMatches(sectionId);
    return safeJsonParse<CustomSectionMatch[]>(json, []);
  }

  /**
   * Match a custom section against activities.
   */
  matchCustomSection(sectionId: string, activityIds: string[]): CustomSectionMatch[] {
    validateId(sectionId, 'section ID');
    const json = persistentEngineMatchCustomSection(sectionId, activityIds);
    return safeJsonParse<CustomSectionMatch[]>(json, []);
  }

  /**
   * Extract section trace from an activity.
   */
  extractSectionTrace(activityId: string, sectionPolylineJson: string): GpsPoint[] {
    validateId(activityId, 'activity ID');
    const flatCoords = persistentEngineExtractSectionTrace(activityId, sectionPolylineJson);
    return flatCoordsToPoints(flatCoords);
  }

  // ==========================================================================
  // Encoded Polyline Methods (~60% smaller than raw coordinates)
  // ==========================================================================

  /**
   * Get GPS track as Google-encoded polyline string.
   * ~60% smaller than flat coordinate arrays.
   * Decode with @mapbox/polyline or similar library.
   */
  getGpsTrackEncoded(activityId: string): string {
    validateId(activityId, 'activity ID');
    return persistentEngineGetGpsTrackEncoded(activityId);
  }

  /**
   * Get section polyline as Google-encoded string.
   * Works for both auto-detected and custom sections.
   */
  getSectionPolylineEncoded(sectionId: string): string {
    validateId(sectionId, 'section ID');
    return persistentEngineGetSectionPolylineEncoded(sectionId);
  }

  // ==========================================================================
  // Section Reference (Medoid) Methods
  // Uses dynamic require to avoid ESLint removing "unused" imports
  // ==========================================================================

  /**
   * Set the reference activity for a section (user-defined medoid).
   * This also updates the section's polyline to match the reference activity's trace.
   * @returns true if successful, false otherwise
   */
  setSectionReference(sectionId: string, activityId: string): boolean {
    validateId(sectionId, 'section ID');
    validateId(activityId, 'activity ID');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generated = require('./generated/veloqrs');
    const result = generated.persistentEngineSetSectionReference(sectionId, activityId) as boolean;
    if (result) {
      this.notify('sections');
    }
    return result;
  }

  /**
   * Reset a section's reference to automatic (algorithm-selected medoid).
   * @returns true if successful, false otherwise
   */
  resetSectionReference(sectionId: string): boolean {
    validateId(sectionId, 'section ID');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generated = require('./generated/veloqrs');
    const result = generated.persistentEngineResetSectionReference(sectionId) as boolean;
    if (result) {
      this.notify('sections');
    }
    return result;
  }

  /**
   * Get the current reference activity ID for a section.
   * @returns The activity ID that is the current reference (medoid), or undefined if not found
   */
  getSectionReference(sectionId: string): string | undefined {
    validateId(sectionId, 'section ID');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generated = require('./generated/veloqrs');
    return generated.persistentEngineGetSectionReference(sectionId) as string | undefined;
  }

  /**
   * Check if a section's reference is user-defined (vs auto-selected).
   * @returns true if user manually set the reference, false if algorithm-selected
   */
  isSectionReferenceUserDefined(sectionId: string): boolean {
    validateId(sectionId, 'section ID');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generated = require('./generated/veloqrs');
    return generated.persistentEngineIsSectionReferenceUserDefined(sectionId) as boolean;
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

  /**
   * Manually trigger a refresh for subscribers of the given event type.
   * Use this to refresh UI after navigating back from a detail page.
   */
  triggerRefresh(event: 'groups' | 'sections' | 'activities'): void {
    this.notify(event);
  }
}

// Export the singleton instance for backward compatibility
export const routeEngine = RouteEngineClient.getInstance();

// =============================================================================
// Standalone Polyline Encoding Functions
// Use these for encoding/decoding outside the RouteEngineClient
// =============================================================================

/**
 * Encode flat coordinates [lat, lng, lat, lng, ...] to Google polyline string.
 * ~60% smaller than raw coordinate arrays.
 */
export function encodeToPolyline(coords: number[]): string {
  return encodeCoordinatesToPolyline(coords);
}

/**
 * Decode Google polyline string to flat coordinates [lat, lng, lat, lng, ...].
 */
export function decodeFromPolyline(encoded: string): number[] {
  return decodePolylineToCoordinates(encoded);
}
