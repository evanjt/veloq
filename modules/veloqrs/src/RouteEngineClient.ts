/**
 * RouteEngineClient - Backward compatibility layer for existing app code.
 *
 * Delegates to domain-specific UniFFI Objects (VeloqEngine, SectionManager,
 * ActivityManager, etc.) via dynamic require. The generated bindings are
 * resolved at runtime so tsc doesn't need them to exist at compile time.
 *
 * After Rust rebuild, the generated module will contain the new object classes.
 */

import type {
  PersistentEngineStats,
  FfiActivityMetrics,
  FfiBounds,
  FfiGpsPoint,
  FfiRouteGroup,
  FfiFrequentSection,
  FfiSection,
  FfiSectionPerformanceResult,
  FfiCalendarSummary,
  FfiRoutePerformanceResult,
  FfiRankedSection,
  FfiEfficiencyTrend,
  SectionSummary,
  GroupSummary,
  MapActivityComplete,
  FfiPeriodStats,
  FfiFtpTrend,
  FfiPaceTrend,
  FfiInsightsData,
  FfiStartupData,
  FfiRoutesScreenData,
  FfiPotentialSection,
  DownloadProgressResult,
} from './generated/veloqrs';

// Types for new FFI methods — will be auto-generated after Rust rebuild.
// Declarations moved to ./delegates/shared-types.ts; re-exported here so
// existing consumers (e.g. `import { FfiSectionMatch } from '...'`) keep working.
export type {
  FfiSectionMatch,
  FfiMergeCandidate,
  FfiNearbySectionSummary,
  FfiActivitySectionHighlight,
  FfiActivityRouteHighlight,
  FfiActivityIndicator,
  SectionEncounter,
} from './delegates/shared-types';

import type { RoutePoint, SectionDetectionProgress } from './conversions';
import type { DelegateHost } from './delegates/host';
import * as activityDelegates from './delegates/activities';
import * as detectionDelegates from './delegates/detection';
import * as fitnessDelegates from './delegates/fitness';
import * as heatmapDelegates from './delegates/heatmap';
import * as mapsDelegates from './delegates/maps';
import * as routeDelegates from './delegates/routes';
import * as sectionDelegates from './delegates/sections';
import * as settingsDelegates from './delegates/settings';
import * as strengthDelegates from './delegates/strength';
import type {
  FfiActivityIndicator,
  FfiActivityRouteHighlight,
  FfiActivitySectionHighlight,
  FfiMergeCandidate,
  FfiNearbySectionSummary,
  FfiSectionMatch,
  HeatmapDay,
  SectionEncounter,
} from './delegates/shared-types';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const gen = (): any => require('./generated/veloqrs');

/** Pre-computed daily activity intensity from Rust heatmap cache. Re-exported from delegates. */
export type { HeatmapDay };

class RouteEngineClient implements DelegateHost {
  private static instance: RouteEngineClient;
  private listeners: Map<string, Set<() => void>> = new Map();
  private initialized = false;
  private dbPath: string | null = null;
  private pendingMetrics: FfiActivityMetrics[] | null = null;

  // Cached domain object handles (created once via VeloqEngine factory)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: any = null;

  private constructor() {}

  /** Check if engine is ready. Methods called before initWithPath() return safe defaults. */
  get ready(): boolean {
    return this.engine !== null;
  }

  timed<T>(name: string, fn: () => T): T {
    const shouldLog = typeof __DEV__ !== 'undefined' && __DEV__;
    const shouldRecord = RouteEngineClient.debugEnabled;
    if (!shouldLog && !shouldRecord) return fn();
    const start = performance.now();
    const result = fn();
    const ms = performance.now() - start;
    if (shouldLog) {
      const icon = ms > 100 ? '\u{1F534}' : ms > 50 ? '\u{1F7E1}' : '\u{1F7E2}';
      console.log(`${icon} [FFI] ${name}: ${ms.toFixed(1)}ms`);
    }
    if (shouldRecord) {
      RouteEngineClient.recordMetric(name, ms);
    }
    return result;
  }

  private static debugEnabled = false;
  private static recordMetric: (name: string, ms: number) => void = () => {};

  static setDebugEnabled(enabled: boolean): void {
    RouteEngineClient.debugEnabled = enabled;
  }

  static setMetricRecorder(recorder: (name: string, ms: number) => void): void {
    RouteEngineClient.recordMetric = recorder;
  }

  static getInstance(): RouteEngineClient {
    if (!this.instance) {
      this.instance = new RouteEngineClient();
    }
    return this.instance;
  }

  initWithPath(dbPath: string): boolean {
    if (this.initialized && this.dbPath === dbPath) return true;
    const result = this.timed('initWithPath', () => {
      this.engine = gen().VeloqEngine.create(dbPath);
      return true;
    });
    if (result) {
      this.initialized = true;
      this.dbPath = dbPath;
      // Heatmap tiles path is set lazily via enableHeatmapTiles() — called from app
      // code when the heatmap setting is enabled. This avoids importing provider stores
      // in the native module.
      if (this.pendingMetrics) {
        this.timed('setActivityMetrics', () =>
          this.engine.activities().setMetrics(this.pendingMetrics!)
        );
        this.pendingMetrics = null;
        this.notify('activities');
      }
    }
    return result;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isPersistent(): boolean {
    return this.dbPath !== null;
  }

  /** Clear only route/section data, keeping GPS tracks and activities.
   *  Used when route matching is toggled off to free storage. */
  clearRoutesAndSections(): void {
    if (!this.ready) return;
    try {
      this.engine.clearRoutesAndSections();
    } catch (e) {
      console.warn('[RouteEngineClient] Failed to clear routes and sections:', e);
    }
  }

  /** Drop the Rust engine singleton without clearing data. Used before database restore. */
  destroyEngine(): void {
    try {
      this.engine?.destroy();
    } catch {
      // Best-effort destroy
    }
    this.initialized = false;
    this.dbPath = null;
    this.engine = null;
    this.pendingMetrics = null;
  }

  clear(): void {
    try {
      this.timed('clear', () => this.engine?.clear());
    } catch {
      // Best-effort clear — reset local state regardless
    }
    try {
      // Drop the Rust PERSISTENT_ENGINE global so the next create() re-initializes
      // from scratch. Without this, the global retains stale data (e.g., from demo mode)
      // because create() skips init when the global is already Some.
      this.engine?.destroy();
    } catch {
      // Best-effort destroy
    }
    this.initialized = false;
    this.dbPath = null;
    this.engine = null;
    this.pendingMetrics = null;
    this.notifyAll('activities', 'groups', 'sections', 'syncReset');
  }

  addActivities = (
    activityIds: string[],
    allCoords: number[],
    offsets: number[],
    sportTypes: string[]
  ): Promise<void> =>
    activityDelegates.addActivities(this, activityIds, allCoords, offsets, sportTypes);

  getActivityIds = (): string[] => activityDelegates.getActivityIds(this);

  getActivityMetricIds = (): string[] => fitnessDelegates.getActivityMetricIds(this);

  getActivityCount = (): number => activityDelegates.getActivityCount(this);

  cleanupOldActivities = (retentionDays: number): number =>
    activityDelegates.cleanupOldActivities(this, retentionDays);

  markForRecomputation(): void {
    if (!this.ready) return;
    try {
      this.timed('markForRecomputation', () => this.engine.markForRecomputation());
    } catch {
      // Best-effort — engine may have been cleared
    }
  }

  startSectionDetection = (sportFilter?: string): boolean =>
    detectionDelegates.startSectionDetection(this, sportFilter);

  pollSectionDetection = (): string => detectionDelegates.pollSectionDetection(this);

  getSectionDetectionProgress = (): SectionDetectionProgress | null =>
    detectionDelegates.getSectionDetectionProgress(this);

  getGroups = (): FfiRouteGroup[] => routeDelegates.getGroups(this);

  getSections = (): FfiFrequentSection[] => sectionDelegates.getSections(this);

  getSectionsFiltered = (sportType?: string, minVisits?: number): FfiFrequentSection[] =>
    sectionDelegates.getSectionsFiltered(this, sportType, minVisits);

  getSectionsForActivity = (activityId: string): FfiSection[] =>
    sectionDelegates.getSectionsForActivity(this, activityId);

  getSectionSummaries = (sportType?: string): { totalCount: number; summaries: SectionSummary[] } =>
    sectionDelegates.getSectionSummaries(this, sportType);

  getFilteredSectionSummaries = (
    sportType: string | undefined,
    minVisits: number,
    sortKey: sectionDelegates.SectionSortKey
  ): { totalCount: number; summaries: SectionSummary[] } =>
    sectionDelegates.getFilteredSectionSummaries(this, sportType, minVisits, sortKey);

  getRankedSections = (sportType: string, limit: number): FfiRankedSection[] =>
    sectionDelegates.getRankedSections(this, sportType, limit);

  getRankedSectionsBatch = (
    sportTypes: string[],
    limit: number
  ): sectionDelegates.RankedSectionsBySport[] =>
    sectionDelegates.getRankedSectionsBatch(this, sportTypes, limit);

  getGroupSummaries = (): { totalCount: number; summaries: GroupSummary[] } =>
    routeDelegates.getGroupSummaries(this);

  getFilteredGroupSummaries = (
    minActivities: number,
    sortKey: routeDelegates.GroupSortKey
  ): { totalCount: number; summaries: GroupSummary[] } =>
    routeDelegates.getFilteredGroupSummaries(this, minActivities, sortKey);

  getSectionById = (sectionId: string): FfiFrequentSection | null =>
    sectionDelegates.getSectionById(this, sectionId);

  getGroupById = (groupId: string): FfiRouteGroup | null =>
    routeDelegates.getGroupById(this, groupId);

  getSectionPolyline = (sectionId: string): FfiGpsPoint[] =>
    sectionDelegates.getSectionPolyline(this, sectionId);

  getMapActivitiesFiltered = (
    startDate: Date,
    endDate: Date,
    sportTypesArray?: string[]
  ): MapActivityComplete[] =>
    mapsDelegates.getMapActivitiesFiltered(this, startDate, endDate, sportTypesArray);

  getActivityBoundsForRange = (
    startDate: Date,
    endDate: Date,
    sportTypesArray?: string[]
  ): FfiBounds | null =>
    mapsDelegates.getActivityBoundsForRange(this, startDate, endDate, sportTypesArray);

  getAllMapSignatures = (): Array<{
    activityId: string;
    coords: number[];
    centerLat: number;
    centerLng: number;
  }> => mapsDelegates.getAllMapSignatures(this);

  setRouteName = (routeId: string, name: string): void =>
    routeDelegates.setRouteName(this, routeId, name);

  setSectionName = (sectionId: string, name: string): boolean =>
    sectionDelegates.setSectionName(this, sectionId, name);

  setNameTranslations = (routeWord: string, sectionWord: string): void =>
    settingsDelegates.setNameTranslations(this, routeWord, sectionWord);

  getAllRouteNames = (): Record<string, string> => routeDelegates.getAllRouteNames(this);

  getAllSectionNames = (): Record<string, string> => sectionDelegates.getAllSectionNames(this);

  getGpsTrack = (activityId: string): FfiGpsPoint[] =>
    activityDelegates.getGpsTrack(this, activityId);

  getConsensusRoute = (groupId: string): FfiGpsPoint[] =>
    routeDelegates.getConsensusRoute(this, groupId);

  getRoutePerformances = (
    routeGroupId: string,
    currentActivityId: string,
    sportType?: string
  ): FfiRoutePerformanceResult =>
    routeDelegates.getRoutePerformances(this, routeGroupId, currentActivityId, sportType);

  excludeActivityFromRoute = (routeId: string, activityId: string): void =>
    routeDelegates.excludeActivityFromRoute(this, routeId, activityId);

  includeActivityInRoute = (routeId: string, activityId: string): void =>
    routeDelegates.includeActivityInRoute(this, routeId, activityId);

  getExcludedRouteActivityIds = (routeId: string): string[] =>
    routeDelegates.getExcludedRouteActivityIds(this, routeId);

  getExcludedRoutePerformances = (routeId: string, sportType?: string): FfiRoutePerformanceResult =>
    routeDelegates.getExcludedRoutePerformances(this, routeId, sportType);

  getSectionPerformances = (sectionId: string, sportType?: string): FfiSectionPerformanceResult =>
    sectionDelegates.getSectionPerformances(this, sectionId, sportType);

  getActivityPrSections = (activityId: string, sectionIds: string[]): string[] =>
    sectionDelegates.getActivityPrSections(this, activityId, sectionIds);

  getWorkoutSections = (
    sportType: string,
    limit: number
  ): sectionDelegates.FfiWorkoutSection[] =>
    sectionDelegates.getWorkoutSections(this, sportType, limit);

  getSectionChartData = (
    sectionId: string,
    timeRangeDays: number,
    sportFilter?: string
  ): sectionDelegates.FfiSectionChartData =>
    sectionDelegates.getSectionChartData(this, sectionId, timeRangeDays, sportFilter);

  getSectionEfficiencyTrend = (sectionId: string): FfiEfficiencyTrend | null =>
    sectionDelegates.getSectionEfficiencyTrend(this, sectionId);

  excludeActivityFromSection = (sectionId: string, activityId: string): boolean =>
    sectionDelegates.excludeActivityFromSection(this, sectionId, activityId);

  includeActivityInSection = (sectionId: string, activityId: string): boolean =>
    sectionDelegates.includeActivityInSection(this, sectionId, activityId);

  getExcludedActivityIds = (sectionId: string): string[] =>
    sectionDelegates.getExcludedActivityIds(this, sectionId);

  getExcludedSectionPerformances = (sectionId: string): FfiSectionPerformanceResult =>
    sectionDelegates.getExcludedSectionPerformances(this, sectionId);

  getSectionCalendarSummary = (sectionId: string): FfiCalendarSummary | null =>
    sectionDelegates.getSectionCalendarSummary(this, sectionId);

  /** Queues metrics until init completes, then delegates to activities module. */
  setActivityMetrics(metrics: FfiActivityMetrics[]): void {
    if (!this.initialized) {
      this.pendingMetrics = metrics;
      return;
    }
    activityDelegates.setActivityMetricsReady(this, metrics);
  }

  setTimeStreams = (streams: Array<{ activityId: string; times: number[] }>): void =>
    activityDelegates.setTimeStreams(this, streams);

  getActivitiesMissingTimeStreams = (activityIds: string[]): string[] =>
    activityDelegates.getActivitiesMissingTimeStreams(this, activityIds);

  queryViewport = (minLat: number, maxLat: number, minLng: number, maxLng: number): string[] =>
    mapsDelegates.queryViewport(this, minLat, maxLat, minLng, maxLng);

  getStats(): PersistentEngineStats | undefined {
    if (!this.ready) return undefined;
    try {
      return this.timed('getStats', () => this.engine.getStats());
    } catch {
      return undefined;
    }
  }

  /** Get activity IDs needing time stream fetch (NULL lap_time, no time_stream). */
  getActivitiesNeedingTimeStreams(): string[] {
    if (!this.ready) return [];
    try {
      return this.timed('getActivitiesNeedingTimeStreams', () =>
        this.engine.getActivitiesNeedingTimeStreams()
      );
    } catch {
      return [];
    }
  }

  getRoutesScreenData = (
    groupLimit = 20,
    groupOffset = 0,
    sectionLimit = 20,
    sectionOffset = 0,
    minGroupActivityCount = 2,
    prioritizeNearestGroups = false,
    prioritizeNearestSections = false,
    userLat = Number.NaN,
    userLng = Number.NaN
  ): FfiRoutesScreenData | undefined =>
    routeDelegates.getRoutesScreenData(
      this,
      groupLimit,
      groupOffset,
      sectionLimit,
      sectionOffset,
      minGroupActivityCount,
      prioritizeNearestGroups,
      prioritizeNearestSections,
      userLat,
      userLng
    );

  getSummaryCardData = (
    currentStart: number,
    currentEnd: number,
    prevStart: number,
    prevEnd: number
  ): {
    currentWeek: FfiPeriodStats;
    prevWeek: FfiPeriodStats;
    ftpTrend: FfiFtpTrend;
    runPaceTrend: FfiPaceTrend;
    swimPaceTrend: FfiPaceTrend;
  } => fitnessDelegates.getSummaryCardData(this, currentStart, currentEnd, prevStart, prevEnd);

  getInsightsData = (
    currentStart: number,
    currentEnd: number,
    prevStart: number,
    prevEnd: number,
    chronicStart: number,
    todayStart: number
  ): FfiInsightsData | undefined =>
    fitnessDelegates.getInsightsData(
      this,
      currentStart,
      currentEnd,
      prevStart,
      prevEnd,
      chronicStart,
      todayStart
    );

  getStartupData = (
    currentStart: number,
    currentEnd: number,
    prevStart: number,
    prevEnd: number,
    chronicStart: number,
    todayStart: number,
    previewActivityIds: string[]
  ): FfiStartupData | undefined =>
    fitnessDelegates.getStartupData(
      this,
      currentStart,
      currentEnd,
      prevStart,
      prevEnd,
      chronicStart,
      todayStart,
      previewActivityIds
    );

  getPeriodStats = (startTs: number, endTs: number): FfiPeriodStats =>
    fitnessDelegates.getPeriodStats(this, startTs, endTs);

  getZoneDistribution = (sportType: string, zoneType: string): number[] =>
    fitnessDelegates.getZoneDistribution(this, sportType, zoneType);

  getFtpTrend = (): FfiFtpTrend => fitnessDelegates.getFtpTrend(this);

  savePaceSnapshot = (
    sportType: string,
    criticalSpeed: number,
    dPrime?: number,
    r2?: number,
    date?: number
  ): void => fitnessDelegates.savePaceSnapshot(this, sportType, criticalSpeed, dPrime, r2, date);

  getPaceTrend = (sportType: string): FfiPaceTrend =>
    fitnessDelegates.getPaceTrend(this, sportType);

  getAvailableSportTypes = (): string[] => fitnessDelegates.getAvailableSportTypes(this);

  getActivityHeatmap = (startDate: string, endDate: string): HeatmapDay[] =>
    fitnessDelegates.getActivityHeatmap(this, startDate, endDate);

  // ==========================================================================
  // Heatmap Tiles (Raster tile generation for map overlay)
  // ==========================================================================
  // Tile generation is handled in Rust on background threads.
  // Only clear is exposed to JS (for settings "clear cache").

  /** Enable heatmap tile generation by setting the tiles path. */
  enableHeatmapTiles = (): void => heatmapDelegates.enableHeatmapTiles(this);

  /** Disable heatmap tile generation by clearing the tiles path in the engine. */
  disableHeatmapTiles = (): void => heatmapDelegates.disableHeatmapTiles(this);

  /** Get total size of heatmap tile cache in bytes (fast native scan). */
  getHeatmapCacheSize = (basePath: string): number =>
    heatmapDelegates.getHeatmapCacheSize(this, basePath);

  /** Clear all heatmap tiles from disk. */
  clearHeatmapTiles = (basePath: string): number =>
    heatmapDelegates.clearHeatmapTiles(this, basePath);

  /** Get heatmap tile generation progress: [processed, total] */
  getHeatmapTileProgress = (): number[] | null => heatmapDelegates.getHeatmapTileProgress(this);

  /** Poll tile generation status: 'idle' | 'running' | 'complete' */
  pollTileGeneration = (): string => heatmapDelegates.pollTileGeneration(this);

  // ==========================================================================
  // Activity Pattern Detection (K-means clustering)
  // ==========================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getActivityPatterns = (): any[] => fitnessDelegates.getActivityPatterns(this);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPatternForToday = (): any | undefined => fitnessDelegates.getPatternForToday(this);

  getActivityPatternsWithToday = (): { today: any | undefined; all: any[] } =>
    fitnessDelegates.getActivityPatternsWithToday(this);

  upsertWellness = (rows: fitnessDelegates.WellnessRowInput[]): void =>
    fitnessDelegates.upsertWellness(this, rows);

  getWellnessSparklines = (days: number): fitnessDelegates.WellnessSparklines | null =>
    fitnessDelegates.getWellnessSparklines(this, days);

  computeHrvTrend = (days: number): fitnessDelegates.HrvTrendResult | null =>
    fitnessDelegates.computeHrvTrend(this, days);

  findStalePrOpportunities = (
    staleThresholdDays: number,
    minGainPercent: number,
    maxOpportunities: number,
    excludeSectionIds: string[]
  ) =>
    fitnessDelegates.findStalePrOpportunities(
      this,
      staleThresholdDays,
      minGainPercent,
      maxOpportunities,
      excludeSectionIds
    );

  // ==========================================================================
  // Athlete Profile & Sport Settings Cache
  // ==========================================================================

  setAthleteProfile = (json: string): void => settingsDelegates.setAthleteProfile(this, json);

  getAthleteProfile = (): string => settingsDelegates.getAthleteProfile(this);

  setSportSettings = (json: string): void => settingsDelegates.setSportSettings(this, json);

  getSportSettings = (): string => settingsDelegates.getSportSettings(this);

  // ==========================================================================
  // User Preferences (SQLite settings table)
  // ==========================================================================

  getSetting = (key: string): string | undefined => settingsDelegates.getSetting(this, key);

  setSetting = (key: string, value: string): void => settingsDelegates.setSetting(this, key, value);

  getAllSettings = (): Record<string, string> => settingsDelegates.getAllSettings(this);

  setAllSettings = (settings: Record<string, string>): void =>
    settingsDelegates.setAllSettings(this, settings);

  deleteSetting = (key: string): void => settingsDelegates.deleteSetting(this, key);

  // ==========================================================================
  // Database Backup
  // ==========================================================================

  backupDatabase(destPath: string): void {
    if (!this.ready) throw new Error('Engine not initialized');
    this.timed('backupDatabase', () => this.engine.backupDatabase(destPath));
  }

  getBackupMetadata(): Record<string, unknown> {
    if (!this.ready) return {};
    try {
      const json = this.engine.getBackupMetadata();
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /** Bulk export all GPS activities as a ZIP of GPX files. Streams in Rust — constant memory. */
  bulkExportGpx(destPath: string): { exported: number; skipped: number; totalBytes: number } {
    if (!this.ready) throw new Error('Engine not initialized');
    const result = this.timed('bulkExportGpx', () => this.engine.bulkExportGpx(destPath));
    return {
      exported: result.exported,
      skipped: result.skipped,
      totalBytes: Number(result.totalBytes),
    };
  }

  /** Bulk export all GPS activities as a single GeoJSON FeatureCollection. */
  bulkExportGeoJson(destPath: string): { exported: number; skipped: number; totalBytes: number } {
    if (!this.ready) throw new Error('Engine not initialized');
    const result = this.timed('bulkExportGeoJson', () => this.engine.bulkExportGeojson(destPath));
    return {
      exported: result.exported,
      skipped: result.skipped,
      totalBytes: Number(result.totalBytes),
    };
  }

  computePolylineOverlap(coordsA: number[], coordsB: number[], thresholdMeters = 50): number {
    return this.timed('computePolylineOverlap', () =>
      gen().computePolylineOverlap(coordsA, coordsB, thresholdMeters)
    );
  }

  getSectionsByType = (sectionType?: 'auto' | 'custom'): FfiSection[] =>
    sectionDelegates.getSectionsByType(this, sectionType);

  createSectionFromIndices = (
    activityId: string,
    startIndex: number,
    endIndex: number,
    sportType: string,
    name?: string
  ): string =>
    sectionDelegates.createSectionFromIndices(
      this,
      activityId,
      startIndex,
      endIndex,
      sportType,
      name,
      this.getGpsTrack
    );

  deleteSection = (sectionId: string): boolean => sectionDelegates.deleteSection(this, sectionId);

  disableSection = (sectionId: string): boolean => sectionDelegates.disableSection(this, sectionId);

  enableSection = (sectionId: string): boolean => sectionDelegates.enableSection(this, sectionId);

  setSuperseded = (autoSectionId: string, customSectionId: string): boolean =>
    sectionDelegates.setSuperseded(this, autoSectionId, customSectionId);

  clearSuperseded = (customSectionId: string): boolean =>
    sectionDelegates.clearSuperseded(this, customSectionId);

  importDisabledIds = (ids: string[]): number => sectionDelegates.importDisabledIds(this, ids);

  importSupersededMap = (map: Record<string, string[]>): number =>
    sectionDelegates.importSupersededMap(this, map);

  getAllSectionsIncludingHidden = (sportType?: string): SectionSummary[] =>
    sectionDelegates.getAllSectionsIncludingHidden(this, sportType);

  detectPotentials = (sportFilter?: string): FfiPotentialSection[] =>
    detectionDelegates.detectPotentials(this, sportFilter);

  extractSectionTrace = (activityId: string, sectionPolylineJson: string): FfiGpsPoint[] =>
    sectionDelegates.extractSectionTrace(this, activityId, sectionPolylineJson);

  extractSectionTracesBatch = (
    activityIds: string[],
    sectionPolylineJson: string
  ): Record<string, RoutePoint[]> =>
    sectionDelegates.extractSectionTracesBatch(this, activityIds, sectionPolylineJson);

  getActivityMetricsForIds = (ids: string[]): FfiActivityMetrics[] =>
    activityDelegates.getActivityMetricsForIds(this, ids);

  setSectionReference = (sectionId: string, activityId: string): boolean =>
    sectionDelegates.setSectionReference(this, sectionId, activityId);

  resetSectionReference = (sectionId: string): boolean =>
    sectionDelegates.resetSectionReference(this, sectionId);

  getSectionReferenceInfo = (sectionId: string): { activityId?: string; isUserDefined: boolean } =>
    sectionDelegates.getSectionReferenceInfo(this, sectionId);

  // ==========================================================================
  // Section Bounds Trimming
  // ==========================================================================

  trimSection = (sectionId: string, startIndex: number, endIndex: number): boolean =>
    sectionDelegates.trimSection(this, sectionId, startIndex, endIndex);

  resetSectionBounds = (sectionId: string): boolean =>
    sectionDelegates.resetSectionBounds(this, sectionId);

  hasOriginalBounds = (sectionId: string): boolean =>
    sectionDelegates.hasOriginalBounds(this, sectionId);

  getSectionExtensionTrack = (
    sectionId: string
  ): { track: number[]; sectionStartIdx: number; sectionEndIdx: number } | null =>
    sectionDelegates.getSectionExtensionTrack(this, sectionId);

  expandSectionBounds = (sectionId: string, newPolylineJson: string): boolean =>
    sectionDelegates.expandSectionBounds(this, sectionId, newPolylineJson);

  getDownloadProgress(): DownloadProgressResult {
    return gen().getDownloadProgress();
  }

  removeActivity = (activityId: string): boolean =>
    activityDelegates.removeActivity(this, activityId);

  debugCloneActivity = (sourceId: string, count: number): number =>
    activityDelegates.debugCloneActivity(this, sourceId, count);

  getActivityHighlightsBundle = (
    activityIds: string[]
  ): activityDelegates.ActivityHighlightsBundle =>
    activityDelegates.getActivityHighlightsBundle(this, activityIds);

  // ========================================================================
  // Strength Training
  // ========================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getExerciseSets = (activityId: string): any[] =>
    strengthDelegates.getExerciseSets(this, activityId);

  isFitProcessed = (activityId: string): boolean =>
    strengthDelegates.isFitProcessed(this, activityId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchAndParseExerciseSets = (authHeader: string, activityId: string): any[] =>
    strengthDelegates.fetchAndParseExerciseSets(this, authHeader, activityId);

  /**
   * Insert pre-parsed exercise sets for an activity without touching the
   * network. Demo-mode only — production uses fetchAndParseExerciseSets.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bulkInsertExerciseSets(activityId: string, sets: any[]): void {
    return this.timed('bulkInsertExerciseSets', () =>
      this.engine.strength().bulkInsertExerciseSets(activityId, sets),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMuscleGroups = (activityId: string): any[] =>
    strengthDelegates.getMuscleGroups(this, activityId);

  getUnprocessedStrengthIds = (activityIds: string[]): string[] =>
    strengthDelegates.getUnprocessedStrengthIds(this, activityIds);

  batchFetchExerciseSets = (authHeader: string, activityIds: string[]): string[] =>
    strengthDelegates.batchFetchExerciseSets(this, authHeader, activityIds);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getStrengthSummary = (startTs: number, endTs: number): any =>
    strengthDelegates.getStrengthSummary(this, startTs, endTs);

  getStrengthInsightSeries = (
    monthly: { startTs: number; endTs: number },
    weekly: Array<{ startTs: number; endTs: number }>
  ): strengthDelegates.StrengthInsightSeries =>
    strengthDelegates.getStrengthInsightSeries(this, monthly, weekly);

  getStrengthSummaryBatch = (
    ranges: Array<{ startTs: number; endTs: number }>
  ): any[] => strengthDelegates.getStrengthSummaryBatch(this, ranges);

  getMuscleDetail = (
    activityId: string,
    muscleSlug: string
  ): strengthDelegates.MuscleGroupDetailFfi | null =>
    strengthDelegates.getMuscleDetail(this, activityId, muscleSlug);

  hasStrengthData = (): boolean => strengthDelegates.hasStrengthData(this);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getExercisesForMuscle = (startTs: number, endTs: number, muscleSlug: string): any =>
    strengthDelegates.getExercisesForMuscle(this, startTs, endTs, muscleSlug);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getActivitiesForExercise = (
    startTs: number,
    endTs: number,
    muscleSlug: string,
    exerciseCategory: number
  ): any =>
    strengthDelegates.getActivitiesForExercise(this, startTs, endTs, muscleSlug, exerciseCategory);

  // ========================================================================
  // Section Matching, Nearby, Merge, Re-detect
  // ========================================================================

  matchActivityToSections = (activityId: string): FfiSectionMatch[] =>
    sectionDelegates.matchActivityToSections(this, activityId);

  rematchActivityToSection = (activityId: string, sectionId: string): boolean =>
    sectionDelegates.rematchActivityToSection(this, activityId, sectionId);

  getNearbySections = (sectionId: string, radiusMeters: number = 500): FfiNearbySectionSummary[] =>
    sectionDelegates.getNearbySections(this, sectionId, radiusMeters);

  getMergeCandidates = (sectionId: string): FfiMergeCandidate[] =>
    sectionDelegates.getMergeCandidates(this, sectionId);

  mergeSections = (primaryId: string, secondaryId: string): string | null =>
    sectionDelegates.mergeSections(this, primaryId, secondaryId);

  getActivitySectionHighlights = (activityIds: string[]): FfiActivitySectionHighlight[] =>
    sectionDelegates.getActivitySectionHighlights(this, activityIds);

  getActivityRouteHighlights = (activityIds: string[]): FfiActivityRouteHighlight[] =>
    routeDelegates.getActivityRouteHighlights(this, activityIds);

  /** Read pre-computed indicators for a batch of activity IDs (from materialized table). */
  getActivityIndicators = (activityIds: string[]): FfiActivityIndicator[] =>
    sectionDelegates.getActivityIndicators(this, activityIds);

  /** Read pre-computed indicators for a single activity. */
  getIndicatorsForActivity = (activityId: string): FfiActivityIndicator[] =>
    sectionDelegates.getIndicatorsForActivity(this, activityId);

  /** Get section encounters for an activity: one entry per (section, direction). */
  getActivitySectionEncounters = (activityId: string): SectionEncounter[] =>
    sectionDelegates.getActivitySectionEncounters(this, activityId);

  /** Recompute all activity indicators (PRs and trends). */
  recomputeIndicators = (): void => sectionDelegates.recomputeIndicators(this);

  forceRedetectSections = (sportFilter?: string): boolean =>
    detectionDelegates.forceRedetectSections(this, sportFilter);

  subscribe(event: string, callback: () => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  triggerRefresh(event: 'groups' | 'sections' | 'activities' | 'syncReset'): void {
    this.notify(event);
  }

  notify(event: string): void {
    this.listeners.get(event)?.forEach((cb) => cb());
  }

  notifyAll(...events: string[]): void {
    events.forEach((event) => this.notify(event));
  }
}

export { RouteEngineClient };
