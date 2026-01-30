/**
 * Route Matcher Native Module
 *
 * Auto-generated Turbo Module bindings via uniffi-bindgen-react-native.
 * Provides high-performance route matching and section detection.
 */

// Import the Turbo Module to install JSI bindings
import NativeVeloqrs from './NativeVeloqrs';

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
  persistentEngineCleanupOldActivities,
  persistentEngineMarkForRecomputation,
  persistentEngineStartSectionDetection,
  persistentEnginePollSections,
  // Direct type returns
  persistentEngineGetGroups,
  persistentEngineGetSections,
  persistentEngineGetSectionCount,
  persistentEngineGetGroupCount,
  persistentEngineGetSectionSummaries,
  persistentEngineGetSectionSummariesForSport,
  persistentEngineGetGroupSummaries,
  persistentEngineGetSectionById,
  persistentEngineGetGroupById,
  persistentEngineGetSectionPolyline,
  persistentEngineSetRouteName,
  persistentEngineSetSectionName,
  persistentEngineGetRouteName,
  persistentEngineGetGpsTrack,
  persistentEngineGetConsensusRoute,
  persistentEngineSetActivityMetrics,
  persistentEngineQueryViewport,
  persistentEngineGetStats,
  persistentEngineDetectPotentials,
  encodeCoordinatesToPolyline,
  decodePolylineToCoordinates,
  persistentEngineExtractSectionTrace,
  // Unified section functions
  createSection as ffiCreateSection,
  deleteSection as ffiDeleteSection,
  persistentEngineSetTimeStreamsFlat,
  persistentEngineGetActivitiesMissingTimeStreams,
  persistentEngineGetAllMapActivitiesComplete,
  persistentEngineGetMapActivitiesFiltered,
  ffiDetectSectionsMultiscale,
  defaultScalePresets,
  fetchActivityMaps,
  fetchActivityMapsWithProgress as generatedFetchWithProgress,
  getDownloadProgress as ffiGetDownloadProgress,
  // Direct-return functions (no JSON parsing needed)
  getSectionsForActivity as ffiGetSectionsForActivity,
  getSections as ffiGetSections,
  persistentEngineGetAllRouteNames,
  persistentEngineGetAllSectionNames,
  persistentEngineGetRoutePerformances,
  persistentEngineGetSectionPerformances,
  type FetchProgressCallback,
  type PersistentEngineStats,
  type FfiActivityMetrics,
  type FfiGpsPoint,
  type FfiRouteGroup,
  type FfiFrequentSection,
  type FfiSection,
  type FfiActivityMapResult,
  type FfiSectionPerformanceResult,
  type FfiRoutePerformanceResult,
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
export type Section = FfiSection;
export type SectionConfig = FfiSectionConfig;
export type SectionPerformanceResult = FfiSectionPerformanceResult;
export type RoutePerformanceResult = FfiRoutePerformanceResult;
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
 * Raw potential section from Rust (uses GpsPoint polyline, not RoutePoint).
 * Internal type - not exported. Caller should convert polyline using gpsPointsToRoutePoints().
 */
interface RawPotentialSection {
  id: string;
  sport_type: string;
  polyline: GpsPoint[];
  activity_ids: string[];
  visit_count: number;
  distance_meters: number;
  confidence: number;
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
 * Progress event from fetch operations.
 */
export interface FetchProgressEvent {
  completed: number;
  total: number;
}

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
    this.notifyAll('activities', 'groups', 'sections', 'syncReset');
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
    // Notify activities and groups (groups are computed lazily)
    this.notifyAll('activities', 'groups');
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
   * Cleanup old activities.
   */
  cleanupOldActivities(retentionDays: number): number {
    const deleted = persistentEngineCleanupOldActivities(retentionDays);
    if (deleted > 0) {
      this.notifyAll('activities', 'groups', 'sections');
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
   * Get all route groups.
   * Returns structured types directly from Rust (no JSON serialization).
   */
  getGroups(): RouteGroup[] {
    return persistentEngineGetGroups();
  }

  /**
   * Get all sections with full data.
   * Returns structured types directly from Rust (no JSON serialization).
   */
  getSections(): FrequentSection[] {
    return persistentEngineGetSections();
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
   * Get sections for a specific activity.
   * Uses junction table for O(1) lookup instead of deserializing all sections.
   * Much faster than getSections() when you only need sections for one activity.
   */
  getSectionsForActivity(activityId: string): Section[] {
    return ffiGetSectionsForActivity(activityId);
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
   * Returns structured types directly from Rust (no JSON serialization).
   */
  getSectionSummaries(): SectionSummary[] {
    return persistentEngineGetSectionSummaries();
  }

  /**
   * Get section summaries filtered by sport type.
   * Returns structured types directly from Rust (no JSON serialization).
   */
  getSectionSummariesForSport(sportType: string): SectionSummary[] {
    return persistentEngineGetSectionSummariesForSport(sportType);
  }

  /**
   * Get lightweight group summaries without full activity ID lists.
   * Returns structured types directly from Rust (no JSON serialization).
   */
  getGroupSummaries(): GroupSummary[] {
    return persistentEngineGetGroupSummaries();
  }

  /**
   * Get a single section by ID with full data (including polyline).
   * Returns structured type directly from Rust (no JSON serialization).
   */
  getSectionById(sectionId: string): FrequentSection | null {
    validateId(sectionId, 'section ID');
    return persistentEngineGetSectionById(sectionId) ?? null;
  }

  /**
   * Get a single group by ID with full data (including activity IDs).
   * Returns structured type directly from Rust (no JSON serialization).
   */
  getGroupById(groupId: string): RouteGroup | null {
    validateId(groupId, 'group ID');
    return persistentEngineGetGroupById(groupId) ?? null;
  }

  /**
   * Get section polyline only (flat coordinates for map rendering).
   * Returns array of GpsPoint or empty array if not found.
   */
  getSectionPolyline(sectionId: string): GpsPoint[] {
    validateId(sectionId, 'section ID');
    const flatCoords = persistentEngineGetSectionPolyline(sectionId);
    return flatCoordsToPoints(flatCoords);
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
   * Get all custom route names.
   * Returns a map of routeId -> customName for all routes with custom names.
   */
  getAllRouteNames(): Record<string, string> {
    const map = persistentEngineGetAllRouteNames();
    return Object.fromEntries(map);
  }

  /**
   * Get all custom section names.
   * Returns a map of sectionId -> customName for all sections with custom names.
   */
  getAllSectionNames(): Record<string, string> {
    const map = persistentEngineGetAllSectionNames();
    return Object.fromEntries(map);
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
   * Returns structured performance data directly (no JSON parsing).
   */
  getRoutePerformances(
    routeGroupId: string,
    currentActivityId: string
  ): FfiRoutePerformanceResult {
    validateId(routeGroupId, 'route group ID');
    if (currentActivityId !== '') {
      validateId(currentActivityId, 'activity ID');
    }
    return persistentEngineGetRoutePerformances(
      routeGroupId,
      currentActivityId || undefined
    );
  }

  /**
   * Get section performances with accurate time-based calculations.
   * Uses time streams to calculate actual traversal times for each section lap.
   * Supports both engine-detected sections and custom sections.
   * Returns structured performance data directly (no JSON parsing).
   */
  getSectionPerformances(sectionId: string): FfiSectionPerformanceResult {
    return persistentEngineGetSectionPerformances(sectionId);
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

  // ==========================================================================
  // Unified Section Operations (replaces legacy custom_sections)
  // ==========================================================================

  /**
   * Get sections by type.
   * @param sectionType - 'auto', 'custom', or undefined for all sections
   */
  getSectionsByType(sectionType?: 'auto' | 'custom'): Section[] {
    return ffiGetSections(sectionType);
  }

  /**
   * Create a section from activity indices.
   * GPS track is loaded from SQLite internally - no coordinate transfer needed.
   * @returns The section ID, or empty string on error
   */
  createSectionFromIndices(
    activityId: string,
    startIndex: number,
    endIndex: number,
    sportType: string,
    name?: string
  ): string {
    validateId(activityId, 'activity ID');

    // Load GPS track to compute polyline
    const track = this.getGpsTrack(activityId);
    if (!track || track.length === 0) {
      throw new Error(`No GPS track found for activity ${activityId}`);
    }

    // Extract the section of the track
    const sectionTrack = track.slice(startIndex, endIndex + 1);
    if (sectionTrack.length < 2) {
      throw new Error('Section must have at least 2 points');
    }

    // Calculate distance
    const distanceMeters = this.calculateTrackDistance(sectionTrack);

    // Create section via unified FFI
    const sectionId = ffiCreateSection(
      sportType,
      JSON.stringify(sectionTrack),
      distanceMeters,
      name || undefined,
      activityId,
      startIndex,
      endIndex
    );

    if (sectionId) {
      this.notify('sections');
    }

    return sectionId;
  }

  /**
   * Calculate distance of a GPS track in meters.
   */
  private calculateTrackDistance(track: GpsPoint[]): number {
    let distance = 0;
    for (let i = 1; i < track.length; i++) {
      const p1 = track[i - 1];
      const p2 = track[i];
      // Haversine formula
      const R = 6371000;
      const dLat = ((p2.latitude - p1.latitude) * Math.PI) / 180;
      const dLon = ((p2.longitude - p1.longitude) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((p1.latitude * Math.PI) / 180) *
          Math.cos((p2.latitude * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      distance += R * c;
    }
    return distance;
  }

  /**
   * Delete a section (works for both auto and custom sections).
   */
  deleteSection(sectionId: string): boolean {
    validateId(sectionId, 'section ID');
    const result = ffiDeleteSection(sectionId);
    if (result) {
      this.notify('sections');
    }
    return result;
  }

  /**
   * Detect potential sections using GPS tracks from SQLite.
   * Single FFI call - all loading happens in Rust (no N+1 pattern).
   * Returns raw potentials with GpsPoint polylines.
   */
  detectPotentials(sportFilter?: string): RawPotentialSection[] {
    const json = persistentEngineDetectPotentials(sportFilter);
    if (!json) return [];
    try {
      return JSON.parse(json) as RawPotentialSection[];
    } catch {
      return [];
    }
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
    const result = generated.setSectionReference(sectionId, activityId) as boolean;
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
    const result = generated.resetSectionReference(sectionId) as boolean;
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
    return generated.getSectionReference(sectionId) as string | undefined;
  }

  /**
   * Check if a section's reference is user-defined (vs auto-selected).
   * @returns true if user manually set the reference, false if algorithm-selected
   */
  isSectionReferenceUserDefined(sectionId: string): boolean {
    validateId(sectionId, 'section ID');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generated = require('./generated/veloqrs');
    return generated.isSectionReferenceUserDefined(sectionId) as boolean;
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
   * Notify listeners of multiple events.
   * Use this to batch notifications when multiple data types are affected.
   */
  private notifyAll(...events: string[]): void {
    events.forEach((event) => this.notify(event));
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
