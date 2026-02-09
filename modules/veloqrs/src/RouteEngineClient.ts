/**
 * RouteEngineClient - Backward compatibility layer for existing app code.
 * Wraps the generated persistent engine functions with the old API.
 */

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
  persistentEngineSetNameTranslations,
  persistentEngineGetRouteName,
  persistentEngineGetGpsTrack,
  persistentEngineGetConsensusRoute,
  persistentEngineSetActivityMetrics,
  persistentEngineQueryViewport,
  persistentEngineGetStats,
  persistentEngineDetectPotentials,
  persistentEngineExtractSectionTrace,
  persistentEngineExtractSectionTracesBatch,
  persistentEngineGetActivityMetricsForIds,
  // Unified section functions
  createSection as ffiCreateSection,
  deleteSection as ffiDeleteSection,
  persistentEngineSetTimeStreamsFlat,
  persistentEngineGetActivitiesMissingTimeStreams,
  persistentEngineGetAllMapActivitiesComplete,
  persistentEngineGetMapActivitiesFiltered,
  // Aggregate query functions (Phase 2)
  persistentEngineGetPeriodStats,
  persistentEngineGetMonthlyAggregates,
  persistentEngineGetActivityHeatmap,
  persistentEngineGetZoneDistribution,
  persistentEngineGetFtpTrend,
  persistentEngineGetAvailableSportTypes,
  // Athlete profile & sport settings cache (Phase 3A-3B)
  persistentEngineSetAthleteProfile,
  persistentEngineGetAthleteProfile,
  persistentEngineSetSportSettings,
  persistentEngineGetSportSettings,
  // Polyline overlap (Phase 4A)
  computePolylineOverlap as ffiComputePolylineOverlap,
  // Direct-return functions (no JSON parsing needed)
  getSectionsForActivity as ffiGetSectionsForActivity,
  getSections as ffiGetSections,
  persistentEngineGetAllRouteNames,
  persistentEngineGetAllSectionNames,
  persistentEngineGetRoutePerformances,
  persistentEngineGetSectionPerformances,
  persistentEngineGetSectionPerformanceBuckets,
  persistentEngineGetRoutesScreenData,
  type FetchProgressCallback,
  type PersistentEngineStats,
  type FfiActivityMetrics,
  type FfiGpsPoint,
  type FfiRouteGroup,
  type FfiFrequentSection,
  type FfiSection,
  type FfiSectionPerformanceResult,
  type FfiSectionPerformanceBucketResult,
  type FfiRoutePerformanceResult,
  type SectionSummary,
  type GroupSummary,
  type MapActivityComplete,
  type FfiPeriodStats,
  type FfiMonthlyAggregate,
  type FfiHeatmapDay,
  type FfiFtpTrend,
  type FfiRoutesScreenData,
} from "./generated/veloqrs";

import {
  flatCoordsToPoints,
  validateId,
  validateName,
  type RoutePoint,
  type SectionDetectionProgress,
  type FetchProgressEvent,
  type RawPotentialSection,
} from "./conversions";

import {
  fetchActivityMaps,
  fetchActivityMapsWithProgress as generatedFetchWithProgress,
  getDownloadProgress as ffiGetDownloadProgress,
  type FfiActivityMapResult,
  type DownloadProgressResult,
} from "./generated/veloqrs";

class RouteEngineClient {
  private static instance: RouteEngineClient;
  private listeners: Map<string, Set<() => void>> = new Map();
  private initialized = false;
  private dbPath: string | null = null;

  private constructor() {}

  /**
   * Wrap an FFI call with timing instrumentation.
   * In __DEV__: logs color-coded duration to console.
   * When debug mode enabled: records to FFI metrics ring buffer.
   */
  private timed<T>(name: string, fn: () => T): T {
    const shouldLog = typeof __DEV__ !== "undefined" && __DEV__;
    const shouldRecord = RouteEngineClient.debugEnabled;
    if (!shouldLog && !shouldRecord) return fn();
    const start = performance.now();
    const result = fn();
    const ms = performance.now() - start;
    if (shouldLog) {
      const icon =
        ms > 100 ? "\u{1F534}" : ms > 50 ? "\u{1F7E1}" : "\u{1F7E2}";
      console.log(`${icon} [FFI] ${name}: ${ms.toFixed(1)}ms`);
    }
    if (shouldRecord) {
      RouteEngineClient.recordMetric(name, ms);
    }
    return result;
  }

  /** Cached debug enabled state — updated by setDebugEnabled() */
  private static debugEnabled = false;
  /** Callback to record FFI metrics — set by setMetricRecorder() */
  private static recordMetric: (name: string, ms: number) => void = () => {};

  /**
   * Set the debug enabled flag. Call when debug mode changes.
   */
  static setDebugEnabled(enabled: boolean): void {
    RouteEngineClient.debugEnabled = enabled;
  }

  /**
   * Set the metric recording function. Call once during app initialization.
   */
  static setMetricRecorder(
    recorder: (name: string, ms: number) => void,
  ): void {
    RouteEngineClient.recordMetric = recorder;
  }

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
    const result = this.timed("initWithPath", () =>
      persistentEngineInit(dbPath),
    );
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
    this.timed("clear", () => persistentEngineClear());
    this.notifyAll("activities", "groups", "sections", "syncReset");
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
    this.timed("addActivities", () =>
      persistentEngineAddActivities(
        activityIds,
        allCoords,
        offsets,
        sportTypes,
      ),
    );
    // Notify activities and groups (groups are computed lazily)
    this.notifyAll("activities", "groups");
  }

  /**
   * Get all activity IDs in the engine.
   */
  getActivityIds(): string[] {
    return this.timed("getActivityIds", () => persistentEngineGetActivityIds());
  }

  /**
   * Get the number of activities.
   */
  getActivityCount(): number {
    return this.timed("getActivityCount", () =>
      persistentEngineGetActivityCount(),
    );
  }

  /**
   * Cleanup old activities.
   */
  cleanupOldActivities(retentionDays: number): number {
    const deleted = this.timed("cleanupOldActivities", () =>
      persistentEngineCleanupOldActivities(retentionDays),
    );
    if (deleted > 0) {
      this.notifyAll("activities", "groups", "sections");
    }
    return deleted;
  }

  /**
   * Mark for recomputation.
   */
  markForRecomputation(): void {
    this.timed("markForRecomputation", () =>
      persistentEngineMarkForRecomputation(),
    );
  }

  /**
   * Start section detection.
   */
  startSectionDetection(sportFilter?: string): boolean {
    return this.timed("startSectionDetection", () =>
      persistentEngineStartSectionDetection(sportFilter),
    );
  }

  /**
   * Poll section detection status.
   * When detection completes, automatically notifies 'sections' subscribers.
   */
  pollSectionDetection(): string {
    const status = this.timed("pollSectionDetection", () =>
      persistentEnginePollSections(),
    );
    // Notify subscribers when section detection completes
    if (status === "complete") {
      this.notify("sections");
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
      const generated = require("./generated/veloqrs");
      if (
        typeof generated.persistentEngineGetSectionDetectionProgress !==
        "function"
      ) {
        return null;
      }
      const json = this.timed(
        "getSectionDetectionProgress",
        () => generated.persistentEngineGetSectionDetectionProgress() as string,
      );

      if (!json || json === "{}") {
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
  getGroups(): FfiRouteGroup[] {
    return this.timed("getGroups", () => persistentEngineGetGroups());
  }

  /**
   * Get all sections with full data.
   * Returns structured types directly from Rust (no JSON serialization).
   */
  getSections(): FfiFrequentSection[] {
    return this.timed("getSections", () => persistentEngineGetSections());
  }

  // ========================================================================
  // Lightweight Query Methods (Query on-demand, don't cache in JS)
  // ========================================================================

  /**
   * Get section count directly from SQLite (no data loading).
   * This is O(1) and doesn't require loading sections into memory.
   */
  getSectionCount(): number {
    return this.timed("getSectionCount", () =>
      persistentEngineGetSectionCount(),
    );
  }

  /**
   * Get sections for a specific activity.
   * Uses junction table for O(1) lookup instead of deserializing all sections.
   * Much faster than getSections() when you only need sections for one activity.
   */
  getSectionsForActivity(activityId: string): FfiSection[] {
    return this.timed("getSectionsForActivity", () =>
      ffiGetSectionsForActivity(activityId),
    );
  }

  /**
   * Get group count directly from SQLite (no data loading).
   * This is O(1) and doesn't require loading groups into memory.
   */
  getGroupCount(): number {
    return this.timed("getGroupCount", () => persistentEngineGetGroupCount());
  }

  /**
   * Get lightweight section summaries without polyline data.
   * Returns structured types directly from Rust (no JSON serialization).
   */
  getSectionSummaries(): SectionSummary[] {
    return this.timed("getSectionSummaries", () =>
      persistentEngineGetSectionSummaries(),
    );
  }

  /**
   * Get section summaries filtered by sport type.
   * Returns structured types directly from Rust (no JSON serialization).
   */
  getSectionSummariesForSport(sportType: string): SectionSummary[] {
    return this.timed("getSectionSummariesForSport", () =>
      persistentEngineGetSectionSummariesForSport(sportType),
    );
  }

  /**
   * Get lightweight group summaries without full activity ID lists.
   * Returns structured types directly from Rust (no JSON serialization).
   */
  getGroupSummaries(): GroupSummary[] {
    return this.timed("getGroupSummaries", () =>
      persistentEngineGetGroupSummaries(),
    );
  }

  /**
   * Get a single section by ID with full data (including polyline).
   * Returns structured type directly from Rust (no JSON serialization).
   */
  getSectionById(sectionId: string): FfiFrequentSection | null {
    validateId(sectionId, "section ID");
    return (
      this.timed("getSectionById", () =>
        persistentEngineGetSectionById(sectionId),
      ) ?? null
    );
  }

  /**
   * Get a single group by ID with full data (including activity IDs).
   * Returns structured type directly from Rust (no JSON serialization).
   */
  getGroupById(groupId: string): FfiRouteGroup | null {
    validateId(groupId, "group ID");
    return (
      this.timed("getGroupById", () => persistentEngineGetGroupById(groupId)) ??
      null
    );
  }

  /**
   * Get section polyline only (flat coordinates for map rendering).
   * Returns array of GpsPoint or empty array if not found.
   */
  getSectionPolyline(sectionId: string): FfiGpsPoint[] {
    validateId(sectionId, "section ID");
    const flatCoords = this.timed("getSectionPolyline", () =>
      persistentEngineGetSectionPolyline(sectionId),
    );
    return flatCoordsToPoints(flatCoords);
  }

  /**
   * Get all map activities with complete data.
   * Returns activities with bounds, name, date, distance, duration, sportType.
   */
  getAllMapActivitiesComplete(): MapActivityComplete[] {
    return this.timed("getAllMapActivitiesComplete", () =>
      persistentEngineGetAllMapActivitiesComplete(),
    );
  }

  /**
   * Get map activities filtered by date range and sport types.
   * All filtering happens in Rust for maximum performance.
   */
  getMapActivitiesFiltered(
    startDate: Date,
    endDate: Date,
    sportTypesArray?: string[],
  ): MapActivityComplete[] {
    const startTs = BigInt(Math.floor(startDate.getTime() / 1000));
    const endTs = BigInt(Math.floor(endDate.getTime() / 1000));
    const sportTypesJson = sportTypesArray?.length
      ? JSON.stringify(sportTypesArray)
      : "";
    return this.timed("getMapActivitiesFiltered", () =>
      persistentEngineGetMapActivitiesFiltered(startTs, endTs, sportTypesJson),
    );
  }

  /**
   * Set route name.
   * @throws Error if routeId or name fails validation
   */
  setRouteName(routeId: string, name: string): void {
    validateId(routeId, "route ID");
    validateName(name, "route name");
    this.timed("setRouteName", () =>
      persistentEngineSetRouteName(routeId, name),
    );
    this.notify("groups");
  }

  /**
   * Set section name.
   * @throws Error if sectionId or name fails validation
   */
  setSectionName(sectionId: string, name: string): void {
    validateId(sectionId, "section ID");
    validateName(name, "section name");
    this.timed("setSectionName", () =>
      persistentEngineSetSectionName(sectionId, name),
    );
    this.notify("sections");
  }

  /**
   * Set translation words for auto-generated route/section names.
   * Called after i18n initialization and when language changes.
   */
  setNameTranslations(routeWord: string, sectionWord: string): void {
    this.timed("setNameTranslations", () =>
      persistentEngineSetNameTranslations(routeWord, sectionWord),
    );
  }

  /**
   * Get route name.
   */
  getRouteName(routeId: string): string {
    validateId(routeId, "route ID");
    return this.timed("getRouteName", () =>
      persistentEngineGetRouteName(routeId),
    );
  }

  /**
   * Get all custom route names.
   * Returns a map of routeId -> customName for all routes with custom names.
   */
  getAllRouteNames(): Record<string, string> {
    const map = this.timed("getAllRouteNames", () =>
      persistentEngineGetAllRouteNames(),
    );
    return Object.fromEntries(map);
  }

  /**
   * Get all custom section names.
   * Returns a map of sectionId -> customName for all sections with custom names.
   */
  getAllSectionNames(): Record<string, string> {
    const map = this.timed("getAllSectionNames", () =>
      persistentEngineGetAllSectionNames(),
    );
    return Object.fromEntries(map);
  }

  /**
   * Get GPS track for an activity.
   * Returns flat array of coordinates [lat1, lng1, lat2, lng2, ...]
   */
  getGpsTrack(activityId: string): FfiGpsPoint[] {
    validateId(activityId, "activity ID");
    const flatCoords = this.timed("getGpsTrack", () =>
      persistentEngineGetGpsTrack(activityId),
    );
    return flatCoordsToPoints(flatCoords);
  }

  /**
   * Get consensus route for a group.
   * Returns flat array of coordinates [lat1, lng1, lat2, lng2, ...]
   */
  getConsensusRoute(groupId: string): FfiGpsPoint[] {
    validateId(groupId, "group ID");
    const flatCoords = this.timed("getConsensusRoute", () =>
      persistentEngineGetConsensusRoute(groupId),
    );
    return flatCoordsToPoints(flatCoords);
  }

  /**
   * Get route performances.
   * Returns structured performance data directly (no JSON parsing).
   */
  getRoutePerformances(
    routeGroupId: string,
    currentActivityId: string,
  ): FfiRoutePerformanceResult {
    validateId(routeGroupId, "route group ID");
    if (currentActivityId !== "") {
      validateId(currentActivityId, "activity ID");
    }
    return this.timed("getRoutePerformances", () =>
      persistentEngineGetRoutePerformances(
        routeGroupId,
        currentActivityId || undefined,
      ),
    );
  }

  /**
   * Get section performances with accurate time-based calculations.
   * Uses time streams to calculate actual traversal times for each section lap.
   * Supports both engine-detected sections and custom sections.
   * Returns structured performance data directly (no JSON parsing).
   */
  getSectionPerformances(sectionId: string): FfiSectionPerformanceResult {
    return this.timed("getSectionPerformances", () =>
      persistentEngineGetSectionPerformances(sectionId),
    );
  }

  /**
   * Get time-bucketed best section performances for chart display.
   * Returns one data point per time bucket, keeping the fastest traversal per bucket.
   * Uses estimates for activities missing time streams — no API fetch required.
   */
  getSectionPerformanceBuckets(
    sectionId: string,
    rangeDays: number,
    bucketType: 'weekly' | 'monthly',
  ): FfiSectionPerformanceBucketResult {
    return this.timed("getSectionPerformanceBuckets", () =>
      persistentEngineGetSectionPerformanceBuckets(sectionId, rangeDays, bucketType),
    );
  }

  /**
   * Set activity metrics.
   * Also notifies 'activities' subscribers since stats (including date range) depend on metrics table.
   */
  setActivityMetrics(metrics: FfiActivityMetrics[]): void {
    this.timed("setActivityMetrics", () =>
      persistentEngineSetActivityMetrics(metrics),
    );
    // Notify activities subscribers - getStats() reads dates from activity_metrics table
    this.notify("activities");
  }

  /**
   * Set time streams for activities.
   * Time streams are cumulative seconds at each GPS point, used for section performance calculations.
   * @param streams - Array of { activityId, times } objects where times is cumulative seconds
   */
  setTimeStreams(
    streams: Array<{ activityId: string; times: number[] }>,
  ): void {
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

    this.timed("setTimeStreams", () =>
      persistentEngineSetTimeStreamsFlat(activityIds, allTimes, offsets),
    );
  }

  /**
   * Get activity IDs that are missing cached time streams.
   * Used to determine which activities need time streams fetched from API.
   * @param activityIds - List of activity IDs to check
   * @returns Activity IDs that don't have cached time streams (either in memory or SQLite)
   */
  getActivitiesMissingTimeStreams(activityIds: string[]): string[] {
    if (activityIds.length === 0) return [];
    return this.timed("getActivitiesMissingTimeStreams", () =>
      persistentEngineGetActivitiesMissingTimeStreams(activityIds),
    );
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
    return this.timed("queryViewport", () =>
      persistentEngineQueryViewport(minLat, maxLat, minLng, maxLng),
    );
  }

  /**
   * Get engine stats.
   */
  getStats(): PersistentEngineStats | undefined {
    return this.timed("getStats", () => persistentEngineGetStats());
  }

  /**
   * Get all data for the Routes screen in a single FFI call.
   * Returns group summaries with consensus polylines, section summaries with polylines,
   * and counts/date range. Supports pagination via limit/offset.
   */
  getRoutesScreenData(
    groupLimit = 20,
    groupOffset = 0,
    sectionLimit = 20,
    sectionOffset = 0,
    minGroupActivityCount = 2,
  ): FfiRoutesScreenData | undefined {
    return this.timed("getRoutesScreenData", () =>
      persistentEngineGetRoutesScreenData(
        groupLimit,
        groupOffset,
        sectionLimit,
        sectionOffset,
        minGroupActivityCount,
      ),
    );
  }

  // ==========================================================================
  // Aggregate Queries (SQL-based, for dashboard/stats/charts)
  // ==========================================================================

  /**
   * Get aggregated stats for a date range.
   * @param startTs - Start Unix timestamp (seconds)
   * @param endTs - End Unix timestamp (seconds)
   */
  getPeriodStats(startTs: number, endTs: number): FfiPeriodStats {
    return this.timed("getPeriodStats", () =>
      persistentEngineGetPeriodStats(BigInt(startTs), BigInt(endTs)),
    );
  }

  /**
   * Get monthly aggregates for a year.
   * @param year - Full year (e.g., 2026)
   * @param metric - "hours" | "distance" | "tss"
   */
  getMonthlyAggregates(year: number, metric: string): FfiMonthlyAggregate[] {
    return this.timed("getMonthlyAggregates", () =>
      persistentEngineGetMonthlyAggregates(year, metric),
    );
  }

  /**
   * Get activity heatmap data for a date range.
   * @param startTs - Start Unix timestamp (seconds)
   * @param endTs - End Unix timestamp (seconds)
   */
  getActivityHeatmap(startTs: number, endTs: number): FfiHeatmapDay[] {
    return this.timed("getActivityHeatmap", () =>
      persistentEngineGetActivityHeatmap(BigInt(startTs), BigInt(endTs)),
    );
  }

  /**
   * Get aggregated zone distribution for a sport type.
   * @param sportType - e.g., "Ride", "Run"
   * @param zoneType - "power" | "hr"
   * @returns Array of total seconds per zone
   */
  getZoneDistribution(sportType: string, zoneType: string): number[] {
    return this.timed("getZoneDistribution", () =>
      persistentEngineGetZoneDistribution(sportType, zoneType),
    );
  }

  /**
   * Get FTP trend: latest and previous distinct FTP values with dates.
   */
  getFtpTrend(): FfiFtpTrend {
    return this.timed("getFtpTrend", () => persistentEngineGetFtpTrend());
  }

  /**
   * Get distinct sport types from stored activities.
   */
  getAvailableSportTypes(): string[] {
    return this.timed("getAvailableSportTypes", () =>
      persistentEngineGetAvailableSportTypes(),
    );
  }

  // ==========================================================================
  // Athlete Profile & Sport Settings Cache
  // ==========================================================================

  /**
   * Store athlete profile JSON in SQLite for instant startup rendering.
   */
  setAthleteProfile(json: string): void {
    this.timed("setAthleteProfile", () =>
      persistentEngineSetAthleteProfile(json),
    );
  }

  /**
   * Get cached athlete profile JSON. Returns empty string if not cached.
   */
  getAthleteProfile(): string {
    return this.timed("getAthleteProfile", () =>
      persistentEngineGetAthleteProfile(),
    );
  }

  /**
   * Store sport settings JSON in SQLite for instant startup rendering.
   */
  setSportSettings(json: string): void {
    this.timed("setSportSettings", () =>
      persistentEngineSetSportSettings(json),
    );
  }

  /**
   * Get cached sport settings JSON. Returns empty string if not cached.
   */
  getSportSettings(): string {
    return this.timed("getSportSettings", () =>
      persistentEngineGetSportSettings(),
    );
  }

  // ==========================================================================
  // Polyline Overlap (Rust R-tree)
  // ==========================================================================

  /**
   * Compute what fraction of polylineA's points are within threshold of polylineB.
   * Uses R-tree for O(n log m) performance.
   * @param coordsA - Flat [lat, lng, lat, lng, ...] array
   * @param coordsB - Flat [lat, lng, lat, lng, ...] array
   * @param thresholdMeters - Distance threshold (default 50m)
   * @returns 0.0-1.0 overlap ratio
   */
  computePolylineOverlap(
    coordsA: number[],
    coordsB: number[],
    thresholdMeters = 50,
  ): number {
    return this.timed("computePolylineOverlap", () =>
      ffiComputePolylineOverlap(coordsA, coordsB, thresholdMeters),
    );
  }

  // ==========================================================================
  // Unified Section Operations (replaces legacy custom_sections)
  // ==========================================================================

  /**
   * Get sections by type.
   * @param sectionType - 'auto', 'custom', or undefined for all sections
   */
  getSectionsByType(sectionType?: "auto" | "custom"): FfiSection[] {
    return this.timed("getSectionsByType", () => ffiGetSections(sectionType));
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
    name?: string,
  ): string {
    validateId(activityId, "activity ID");

    // Load GPS track to compute polyline
    const track = this.getGpsTrack(activityId);
    if (!track || track.length === 0) {
      throw new Error(`No GPS track found for activity ${activityId}`);
    }

    // Extract the section of the track
    const sectionTrack = track.slice(startIndex, endIndex + 1);
    if (sectionTrack.length < 2) {
      throw new Error("Section must have at least 2 points");
    }

    // Create section via unified FFI (distance computed in Rust from polyline)
    const sectionId = this.timed("createSection", () =>
      ffiCreateSection(
        sportType,
        JSON.stringify(sectionTrack),
        0.0, // distance computed in Rust from polyline
        name || undefined,
        activityId,
        startIndex,
        endIndex,
      ),
    );

    if (sectionId) {
      this.notify("sections");
    }

    return sectionId;
  }

  /**
   * Delete a section (works for both auto and custom sections).
   */
  deleteSection(sectionId: string): boolean {
    validateId(sectionId, "section ID");
    const result = this.timed("deleteSection", () =>
      ffiDeleteSection(sectionId),
    );
    if (result) {
      this.notify("sections");
    }
    return result;
  }

  /**
   * Detect potential sections using GPS tracks from SQLite.
   * Single FFI call - all loading happens in Rust (no N+1 pattern).
   * Returns raw potentials with GpsPoint polylines.
   */
  detectPotentials(sportFilter?: string): RawPotentialSection[] {
    const json = this.timed("detectPotentials", () =>
      persistentEngineDetectPotentials(sportFilter),
    );
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
  extractSectionTrace(
    activityId: string,
    sectionPolylineJson: string,
  ): FfiGpsPoint[] {
    validateId(activityId, "activity ID");
    const flatCoords = this.timed("extractSectionTrace", () =>
      persistentEngineExtractSectionTrace(activityId, sectionPolylineJson),
    );
    return flatCoordsToPoints(flatCoords);
  }

  /**
   * Extract section traces for multiple activities in a single FFI call.
   * Builds the section polyline R-tree once, processes activities sequentially.
   * Only one GPS track is in memory at a time (vs all N in the old approach).
   * Returns a map of activityId -> RoutePoint[].
   */
  extractSectionTracesBatch(
    activityIds: string[],
    sectionPolylineJson: string,
  ): Record<string, RoutePoint[]> {
    if (activityIds.length === 0) return {};
    const results = this.timed("extractSectionTracesBatch", () =>
      persistentEngineExtractSectionTracesBatch(
        activityIds,
        sectionPolylineJson,
      ),
    );
    const traces: Record<string, RoutePoint[]> = {};
    for (const batch of results) {
      const points: RoutePoint[] = [];
      for (let i = 0; i < batch.coords.length - 1; i += 2) {
        points.push({ lat: batch.coords[i], lng: batch.coords[i + 1] });
      }
      if (points.length > 0) {
        traces[batch.activityId] = points;
      }
    }
    return traces;
  }

  /**
   * Get activity metrics for a list of activity IDs.
   * Returns metrics from the in-memory HashMap (O(1) per lookup).
   */
  getActivityMetricsForIds(ids: string[]): FfiActivityMetrics[] {
    if (ids.length === 0) return [];
    return this.timed("getActivityMetricsForIds", () =>
      persistentEngineGetActivityMetricsForIds(ids),
    );
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
    validateId(sectionId, "section ID");
    validateId(activityId, "activity ID");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generated = require("./generated/veloqrs");
    const result = this.timed(
      "setSectionReference",
      () => generated.setSectionReference(sectionId, activityId) as boolean,
    );
    if (result) {
      this.notify("sections");
    }
    return result;
  }

  /**
   * Reset a section's reference to automatic (algorithm-selected medoid).
   * @returns true if successful, false otherwise
   */
  resetSectionReference(sectionId: string): boolean {
    validateId(sectionId, "section ID");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generated = require("./generated/veloqrs");
    const result = this.timed(
      "resetSectionReference",
      () => generated.resetSectionReference(sectionId) as boolean,
    );
    if (result) {
      this.notify("sections");
    }
    return result;
  }

  /**
   * Get the current reference activity ID for a section.
   * @returns The activity ID that is the current reference (medoid), or undefined if not found
   */
  getSectionReference(sectionId: string): string | undefined {
    validateId(sectionId, "section ID");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generated = require("./generated/veloqrs");
    return this.timed(
      "getSectionReference",
      () => generated.getSectionReference(sectionId) as string | undefined,
    );
  }

  /**
   * Check if a section's reference is user-defined (vs auto-selected).
   * @returns true if user manually set the reference, false if algorithm-selected
   */
  isSectionReferenceUserDefined(sectionId: string): boolean {
    validateId(sectionId, "section ID");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generated = require("./generated/veloqrs");
    return this.timed(
      "isSectionReferenceUserDefined",
      () => generated.isSectionReferenceUserDefined(sectionId) as boolean,
    );
  }

  /**
   * Fetch activity maps with optional progress reporting.
   */
  async fetchActivityMapsWithProgress(
    authHeader: string,
    activityIds: string[],
    onProgress?: (event: FetchProgressEvent) => void,
  ): Promise<FfiActivityMapResult[]> {
    if (!onProgress) {
      return fetchActivityMaps(authHeader, activityIds);
    }

    const callback: FetchProgressCallback = {
      onProgress: (completed: number, total: number) => {
        onProgress({ completed, total });
      },
    };

    return generatedFetchWithProgress(authHeader, activityIds, callback);
  }

  /**
   * Get current download progress for polling.
   */
  getDownloadProgress(): DownloadProgressResult {
    return ffiGetDownloadProgress();
  }

  /**
   * Clone an activity N times for scale testing (debug only).
   * Copies metadata, metrics, and section_activities. Does NOT copy GPS tracks.
   */
  debugCloneActivity(sourceId: string, count: number): number {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generated = require("./generated/veloqrs");
    const created = this.timed("debugCloneActivity", () =>
      generated.persistentEngineDebugCloneActivity(sourceId, count) as number,
    );
    if (created > 0) {
      this.notifyAll("activities", "groups", "sections");
    }
    return created;
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
   * Manually trigger a refresh for subscribers of the given event type.
   * Use this to refresh UI after navigating back from a detail page.
   */
  triggerRefresh(event: "groups" | "sections" | "activities"): void {
    this.notify(event);
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
}

export { RouteEngineClient };
