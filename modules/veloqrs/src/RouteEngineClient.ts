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
  FfiRecentPr,
  FfiStartupData,
  FfiPreviewTrack,
  FfiRoutesScreenData,
  FfiPotentialSection,
  DownloadProgressResult,
} from './generated/veloqrs';

// Types for new FFI methods — will be auto-generated after Rust rebuild
export interface FfiSectionMatch {
  sectionId: string;
  sectionName: string | undefined;
  sportType: string;
  startIndex: bigint;
  endIndex: bigint;
  matchQuality: number;
  sameDirection: boolean;
  distanceMeters: number;
}

export interface FfiMergeCandidate {
  sectionId: string;
  name: string | undefined;
  sportType: string;
  distanceMeters: number;
  visitCount: number;
  overlapPct: number;
  centerDistanceMeters: number;
}

export interface FfiNearbySectionSummary {
  id: string;
  sectionType: string;
  name: string | undefined;
  sportType: string;
  distanceMeters: number;
  visitCount: number;
  centerDistanceMeters: number;
  polylineCoords: number[];
}

export interface FfiActivitySectionHighlight {
  activityId: string;
  sectionId: string;
  sectionName: string;
  lapTime: number;
  isPr: boolean;
  trend: number;
}

export interface FfiActivityRouteHighlight {
  activityId: string;
  routeId: string;
  routeName: string;
  isPr: boolean;
  trend: number;
}

import * as FileSystem from 'expo-file-system/legacy';
import {
  flatCoordsToPoints,
  validateId,
  validateName,
  type RoutePoint,
  type SectionDetectionProgress,
} from './conversions';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const gen = (): any => require('./generated/veloqrs');

/** Pre-computed daily activity intensity from Rust heatmap cache. */
export interface HeatmapDay {
  date: string;
  intensity: number;
  maxDuration: bigint;
  activityCount: number;
}

// Pre-initialization defaults (typed to match UniFFI-generated types)
const EMPTY_PERIOD_STATS: FfiPeriodStats = {
  count: 0,
  totalDuration: BigInt(0),
  totalDistance: 0,
  totalTss: 0,
};

const EMPTY_FTP_TREND: FfiFtpTrend = {
  latestFtp: undefined,
  latestDate: undefined,
  previousFtp: undefined,
  previousDate: undefined,
};

const EMPTY_PACE_TREND: FfiPaceTrend = {
  latestPace: undefined,
  latestDate: undefined,
  previousPace: undefined,
  previousDate: undefined,
};

const EMPTY_ROUTE_PERFORMANCE_RESULT: FfiRoutePerformanceResult = {
  performances: [],
  activityMetrics: [],
  best: undefined,
  bestForward: undefined,
  bestReverse: undefined,
  forwardStats: undefined,
  reverseStats: undefined,
  currentRank: undefined,
};

const EMPTY_SECTION_PERFORMANCE_RESULT: FfiSectionPerformanceResult = {
  records: [],
  bestRecord: undefined,
  bestForwardRecord: undefined,
  bestReverseRecord: undefined,
  forwardStats: undefined,
  reverseStats: undefined,
};

class RouteEngineClient {
  private static instance: RouteEngineClient;
  private listeners: Map<string, Set<() => void>> = new Map();
  private initialized = false;
  private dbPath: string | null = null;
  private pendingMetrics: FfiActivityMetrics[] | null = null;

  // Cached domain object handles (created once via VeloqEngine factory)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private engine: any = null;

  private constructor() {}

  /** Check if engine is ready. Methods called before initWithPath() return safe defaults. */
  private get ready(): boolean {
    return this.engine !== null;
  }

  private timed<T>(name: string, fn: () => T): T {
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
          this.engine.activities().setMetrics(this.pendingMetrics!),
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

  async addActivities(
    activityIds: string[],
    allCoords: number[],
    offsets: number[],
    sportTypes: string[],
  ): Promise<void> {
    if (!this.ready) return;
    this.timed('addActivities', () =>
      this.engine.activities().add(activityIds, allCoords, offsets, sportTypes),
    );
    this.notifyAll('activities', 'groups');
  }

  getActivityIds(): string[] {
    if (!this.ready) return [];
    return this.timed('getActivityIds', () => this.engine.activities().getIds());
  }

  getActivityMetricIds(): string[] {
    if (!this.ready) return [];
    return this.timed('getActivityMetricIds', () => this.engine.fitness().getActivityMetricIds());
  }

  getActivityCount(): number {
    if (!this.ready) return 0;
    return this.timed('getActivityCount', () => this.engine.activities().getCount());
  }

  cleanupOldActivities(retentionDays: number): number {
    if (!this.ready) return 0;
    const deleted = this.timed('cleanupOldActivities', () =>
      this.engine.cleanupOldActivities(retentionDays),
    );
    if (deleted > 0) {
      this.notifyAll('activities', 'groups', 'sections');
    }
    return deleted;
  }

  markForRecomputation(): void {
    if (!this.ready) return;
    try {
      this.timed('markForRecomputation', () => this.engine.markForRecomputation());
    } catch {
      // Best-effort — engine may have been cleared
    }
  }

  startSectionDetection(sportFilter?: string): boolean {
    if (!this.ready) return false;
    return this.timed('startSectionDetection', () => this.engine.detection().start(sportFilter));
  }

  pollSectionDetection(): string {
    if (!this.ready) return 'idle';
    try {
      const status = this.timed('pollSectionDetection', () => this.engine.detection().poll());
      if (status === 'complete') {
        this.notify('sections');
      }
      return status;
    } catch {
      return 'error';
    }
  }

  getSectionDetectionProgress(): SectionDetectionProgress | null {
    if (!this.ready) return null;
    return (
      this.timed('getSectionDetectionProgress', () => this.engine.detection().getProgress()) ?? null
    );
  }

  getGroups(): FfiRouteGroup[] {
    if (!this.ready) return [];
    return this.timed('getGroups', () => this.engine.routes().getAll());
  }

  getSections(): FfiFrequentSection[] {
    if (!this.ready) return [];
    return this.timed('getSections', () => this.engine.sections().getAll());
  }

  getSectionsFiltered(sportType?: string, minVisits?: number): FfiFrequentSection[] {
    if (!this.ready) return [];
    return this.timed('getSectionsFiltered', () =>
      this.engine.sections().getFiltered(sportType ?? null, minVisits ?? null),
    );
  }

  getSectionsForActivity(activityId: string): FfiSection[] {
    if (!this.ready) return [];
    return this.timed('getSectionsForActivity', () =>
      this.engine.sections().getForActivity(activityId),
    );
  }

  getSectionSummaries(sportType?: string): { totalCount: number; summaries: SectionSummary[] } {
    if (!this.ready) return { totalCount: 0, summaries: [] };
    return this.timed('getSectionSummaries', () =>
      this.engine.sections().getSummariesWithCount(sportType),
    );
  }

  getRankedSections(sportType: string, limit: number): FfiRankedSection[] {
    if (!this.ready) return [];
    return this.timed('getRankedSections', () =>
      this.engine.sections().getRanked(sportType, limit),
    );
  }

  getGroupSummaries(): { totalCount: number; summaries: GroupSummary[] } {
    if (!this.ready) return { totalCount: 0, summaries: [] };
    return this.timed('getGroupSummaries', () =>
      this.engine.routes().getSummariesWithCount(),
    );
  }

  getSectionById(sectionId: string): FfiFrequentSection | null {
    if (!this.ready) return null;
    validateId(sectionId, 'section ID');
    return this.timed('getSectionById', () => this.engine.sections().getById(sectionId)) ?? null;
  }

  getGroupById(groupId: string): FfiRouteGroup | null {
    if (!this.ready) return null;
    validateId(groupId, 'group ID');
    return this.timed('getGroupById', () => this.engine.routes().getById(groupId)) ?? null;
  }

  getSectionPolyline(sectionId: string): FfiGpsPoint[] {
    if (!this.ready) return [];
    validateId(sectionId, 'section ID');
    return this.timed('getSectionPolyline', () => this.engine.sections().getPolyline(sectionId));
  }

  getMapActivitiesFiltered(
    startDate: Date,
    endDate: Date,
    sportTypesArray?: string[],
  ): MapActivityComplete[] {
    if (!this.ready) return [];
    const startTs = BigInt(Math.floor(startDate.getTime() / 1000));
    const endTs = BigInt(Math.floor(endDate.getTime() / 1000));
    return this.timed('getMapActivitiesFiltered', () =>
      this.engine.maps().getFiltered(startTs, endTs, sportTypesArray ?? []),
    );
  }

  getActivityBoundsForRange(
    startDate: Date,
    endDate: Date,
    sportTypesArray?: string[],
  ): FfiBounds | null {
    if (!this.ready) return null;
    const startTs = BigInt(Math.floor(startDate.getTime() / 1000));
    const endTs = BigInt(Math.floor(endDate.getTime() / 1000));
    const result = this.timed('getActivityBoundsForRange', () =>
      this.engine.maps().getBoundsForRange(startTs, endTs, sportTypesArray ?? []),
    );
    return result ?? null;
  }

  getAllMapSignatures(): Array<{
    activityId: string;
    coords: number[];
    centerLat: number;
    centerLng: number;
  }> {
    if (!this.ready) return [];
    return this.timed('getAllMapSignatures', () => this.engine.maps().getAllSignatures());
  }

  setRouteName(routeId: string, name: string): void {
    if (!this.ready) return;
    validateId(routeId, 'route ID');
    validateName(name, 'route name');
    this.timed('setRouteName', () => this.engine.routes().setName(routeId, name));
    this.notify('groups');
  }

  setSectionName(sectionId: string, name: string): boolean {
    if (!this.ready) return false;
    validateId(sectionId, 'section ID');
    validateName(name, 'section name');
    try {
      this.timed('setSectionName', () => this.engine.sections().setName(sectionId, name));
      this.notify('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] setSectionName failed:', sectionId, e);
      return false;
    }
  }


  setNameTranslations(routeWord: string, sectionWord: string): void {
    if (!this.ready) return;
    this.timed('setNameTranslations', () =>
      this.engine.setNameTranslations(routeWord, sectionWord),
    );
  }

  getAllRouteNames(): Record<string, string> {
    if (!this.ready) return {};
    const map = this.timed('getAllRouteNames', () => this.engine.routes().getAllNames());
    return Object.fromEntries(map);
  }

  getAllSectionNames(): Record<string, string> {
    if (!this.ready) return {};
    const map = this.timed('getAllSectionNames', () => this.engine.sections().getAllNames());
    return Object.fromEntries(map);
  }

  getGpsTrack(activityId: string): FfiGpsPoint[] {
    if (!this.ready) return [];
    validateId(activityId, 'activity ID');
    return this.timed('getGpsTrack', () => this.engine.activities().getGpsTrack(activityId));
  }

  getConsensusRoute(groupId: string): FfiGpsPoint[] {
    if (!this.ready) return [];
    validateId(groupId, 'group ID');
    return this.timed('getConsensusRoute', () =>
      this.engine.routes().getConsensusRoute(groupId),
    );
  }

  getRoutePerformances(
    routeGroupId: string,
    currentActivityId: string,
    sportType?: string,
  ): FfiRoutePerformanceResult {
    if (!this.ready) {
      return EMPTY_ROUTE_PERFORMANCE_RESULT;
    }
    validateId(routeGroupId, 'route group ID');
    if (currentActivityId !== '') {
      validateId(currentActivityId, 'activity ID');
    }
    return this.timed('getRoutePerformances', () =>
      this.engine.routes().getPerformances(routeGroupId, currentActivityId || undefined, sportType),
    );
  }

  excludeActivityFromRoute(routeId: string, activityId: string): void {
    if (!this.ready) return;
    this.timed('excludeActivityFromRoute', () =>
      this.engine.routes().excludeActivity(routeId, activityId),
    );
    this.notify('groups');
  }

  includeActivityInRoute(routeId: string, activityId: string): void {
    if (!this.ready) return;
    this.timed('includeActivityInRoute', () =>
      this.engine.routes().includeActivity(routeId, activityId),
    );
    this.notify('groups');
  }

  getExcludedRouteActivityIds(routeId: string): string[] {
    if (!this.ready) return [];
    return this.timed('getExcludedRouteActivityIds', () =>
      this.engine.routes().getExcludedActivities(routeId),
    );
  }

  getExcludedRoutePerformances(routeId: string, sportType?: string): FfiRoutePerformanceResult {
    if (!this.ready) {
      return EMPTY_ROUTE_PERFORMANCE_RESULT;
    }
    return this.timed('getExcludedRoutePerformances', () =>
      this.engine.routes().getExcludedPerformances(routeId, sportType),
    );
  }

  getSectionPerformances(sectionId: string, sportType?: string): FfiSectionPerformanceResult {
    if (!this.ready) {
      return EMPTY_SECTION_PERFORMANCE_RESULT;
    }
    return this.timed('getSectionPerformances', () =>
      this.engine.sections().getPerformances(sectionId, sportType),
    );
  }

  getSectionEfficiencyTrend(sectionId: string): FfiEfficiencyTrend | null {
    if (!this.ready) {
      return null;
    }
    return this.timed('getSectionEfficiencyTrend', () =>
      this.engine.sections().getEfficiencyTrend(sectionId) ?? null,
    );
  }

  excludeActivityFromSection(sectionId: string, activityId: string): boolean {
    if (!this.ready) return false;
    try {
      this.timed('excludeActivityFromSection', () =>
        this.engine.sections().excludeActivity(sectionId, activityId),
      );
      this.notify('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] excludeActivityFromSection failed:', sectionId, activityId, e);
      return false;
    }
  }

  includeActivityInSection(sectionId: string, activityId: string): boolean {
    if (!this.ready) return false;
    try {
      this.timed('includeActivityInSection', () =>
        this.engine.sections().includeActivity(sectionId, activityId),
      );
      this.notify('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] includeActivityInSection failed:', sectionId, activityId, e);
      return false;
    }
  }

  getExcludedActivityIds(sectionId: string): string[] {
    if (!this.ready) return [];
    return this.timed('getExcludedActivityIds', () =>
      this.engine.sections().getExcludedActivities(sectionId),
    );
  }

  getExcludedSectionPerformances(sectionId: string): FfiSectionPerformanceResult {
    if (!this.ready) {
      return EMPTY_SECTION_PERFORMANCE_RESULT;
    }
    return this.timed('getExcludedSectionPerformances', () =>
      this.engine.sections().getExcludedPerformances(sectionId),
    );
  }

  getSectionCalendarSummary(sectionId: string): FfiCalendarSummary | null {
    if (!this.ready) return null;
    return (
      this.timed('getSectionCalendarSummary', () =>
        this.engine.sections().getCalendarSummary(sectionId),
      ) ?? null
    );
  }

  setActivityMetrics(metrics: FfiActivityMetrics[]): void {
    if (!this.initialized) {
      this.pendingMetrics = metrics;
      return;
    }
    this.timed('setActivityMetrics', () => this.engine.activities().setMetrics(metrics));
    this.notify('activities');
  }

  setTimeStreams(streams: Array<{ activityId: string; times: number[] }>): void {
    if (!this.ready || streams.length === 0) return;

    const activityIds: string[] = [];
    const allTimes: number[] = [];
    const offsets: number[] = [0];

    for (const stream of streams) {
      activityIds.push(stream.activityId);
      allTimes.push(...stream.times);
      offsets.push(allTimes.length);
    }

    this.timed('setTimeStreams', () =>
      this.engine.activities().setTimeStreams(activityIds, allTimes, offsets),
    );
  }

  getActivitiesMissingTimeStreams(activityIds: string[]): string[] {
    if (!this.ready || activityIds.length === 0) return [];
    return this.timed('getActivitiesMissingTimeStreams', () =>
      this.engine.activities().getMissingTimeStreams(activityIds),
    );
  }

  queryViewport(minLat: number, maxLat: number, minLng: number, maxLng: number): string[] {
    if (!this.ready) return [];
    return this.timed('queryViewport', () =>
      this.engine.maps().queryViewport(minLat, maxLat, minLng, maxLng),
    );
  }

  getStats(): PersistentEngineStats | undefined {
    if (!this.ready) return undefined;
    try {
      return this.timed('getStats', () => this.engine.getStats());
    } catch {
      return undefined;
    }
  }

  getRoutesScreenData(
    groupLimit = 20,
    groupOffset = 0,
    sectionLimit = 20,
    sectionOffset = 0,
    minGroupActivityCount = 2,
    prioritizeNearestGroups = false,
    prioritizeNearestSections = false,
    userLat = Number.NaN,
    userLng = Number.NaN,
  ): FfiRoutesScreenData | undefined {
    if (!this.ready) return undefined;
    try {
      return this.timed('getRoutesScreenData', () =>
        this.engine
          .routes()
          .getScreenData(
            groupLimit,
            groupOffset,
            sectionLimit,
            sectionOffset,
            minGroupActivityCount,
            prioritizeNearestGroups,
            prioritizeNearestSections,
            userLat,
            userLng,
          ),
      );
    } catch {
      return undefined;
    }
  }

  getSummaryCardData(
    currentStart: number,
    currentEnd: number,
    prevStart: number,
    prevEnd: number,
  ): {
    currentWeek: FfiPeriodStats;
    prevWeek: FfiPeriodStats;
    ftpTrend: FfiFtpTrend;
    runPaceTrend: FfiPaceTrend;
    swimPaceTrend: FfiPaceTrend;
  } {
    if (!this.ready) {
      return {
        currentWeek: EMPTY_PERIOD_STATS,
        prevWeek: EMPTY_PERIOD_STATS,
        ftpTrend: EMPTY_FTP_TREND,
        runPaceTrend: EMPTY_PACE_TREND,
        swimPaceTrend: EMPTY_PACE_TREND,
      };
    }
    return this.timed('getSummaryCardData', () =>
      this.engine
        .fitness()
        .getSummaryCardData(BigInt(currentStart), BigInt(currentEnd), BigInt(prevStart), BigInt(prevEnd)),
    );
  }

  getInsightsData(
    currentStart: number,
    currentEnd: number,
    prevStart: number,
    prevEnd: number,
    chronicStart: number,
    todayStart: number,
  ): FfiInsightsData | undefined {
    if (!this.ready) return undefined;
    return this.timed('getInsightsData', () =>
      this.engine
        .fitness()
        .getInsightsData(
          BigInt(currentStart),
          BigInt(currentEnd),
          BigInt(prevStart),
          BigInt(prevEnd),
          BigInt(chronicStart),
          BigInt(todayStart),
        ),
    );
  }

  getStartupData(
    currentStart: number,
    currentEnd: number,
    prevStart: number,
    prevEnd: number,
    chronicStart: number,
    todayStart: number,
    previewActivityIds: string[],
  ): FfiStartupData | undefined {
    if (!this.ready) return undefined;
    return this.timed('getStartupData', () =>
      this.engine
        .fitness()
        .getStartupData(
          BigInt(currentStart),
          BigInt(currentEnd),
          BigInt(prevStart),
          BigInt(prevEnd),
          BigInt(chronicStart),
          BigInt(todayStart),
          previewActivityIds,
        ),
    );
  }

  getPeriodStats(startTs: number, endTs: number): FfiPeriodStats {
    if (!this.ready) return EMPTY_PERIOD_STATS;
    return this.timed('getPeriodStats', () =>
      this.engine.fitness().getPeriodStats(BigInt(startTs), BigInt(endTs)),
    );
  }

  getZoneDistribution(sportType: string, zoneType: string): number[] {
    if (!this.ready) return [];
    return this.timed('getZoneDistribution', () =>
      this.engine.fitness().getZoneDistribution(sportType, zoneType),
    );
  }

  getFtpTrend(): FfiFtpTrend {
    if (!this.ready) return EMPTY_FTP_TREND;
    return this.timed('getFtpTrend', () => this.engine.fitness().getFtpTrend());
  }

  savePaceSnapshot(
    sportType: string,
    criticalSpeed: number,
    dPrime?: number,
    r2?: number,
    date?: number,
  ): void {
    if (!this.ready) return;
    const ts = date ?? Math.floor(Date.now() / 1000);
    try {
      this.timed('savePaceSnapshot', () =>
        this.engine.fitness().savePaceSnapshot(sportType, criticalSpeed, dPrime, r2, BigInt(ts)),
      );
    } catch {
      // Pace snapshot save failed — non-critical
    }
  }

  getPaceTrend(sportType: string): FfiPaceTrend {
    if (!this.ready) return EMPTY_PACE_TREND;
    return this.timed('getPaceTrend', () => this.engine.fitness().getPaceTrend(sportType));
  }

  getAvailableSportTypes(): string[] {
    if (!this.ready) return [];
    return this.timed('getAvailableSportTypes', () =>
      this.engine.fitness().getAvailableSportTypes(),
    );
  }

  getActivityHeatmap(startDate: string, endDate: string): HeatmapDay[] {
    if (!this.ready) return [];
    return this.timed('getActivityHeatmap', () =>
      this.engine.fitness().getActivityHeatmap(startDate, endDate),
    );
  }

  // ==========================================================================
  // Heatmap Tiles (Raster tile generation for map overlay)
  // ==========================================================================
  // Tile generation is handled in Rust on background threads.
  // Only clear is exposed to JS (for settings "clear cache").

  /** Enable heatmap tile generation by setting the tiles path. */
  enableHeatmapTiles(): void {
    if (!this.ready) return;
    const tilesPath = `${FileSystem.cacheDirectory}heatmap-tiles/`;
    const normalizedTilesPath = tilesPath.startsWith('file://')
      ? tilesPath.slice(7)
      : tilesPath;
    try {
      this.engine.heatmap().setTilesPath(normalizedTilesPath);
    } catch (e) {
      console.warn('[RouteEngineClient] Failed to set heatmap tiles path:', e);
    }
  }

  /** Disable heatmap tile generation by clearing the tiles path in the engine. */
  disableHeatmapTiles(): void {
    if (!this.ready) return;
    try {
      this.engine.heatmap().clearTilesPath();
    } catch (e) {
      console.warn('[RouteEngineClient] Failed to clear heatmap tiles path:', e);
    }
  }

  /** Get total size of heatmap tile cache in bytes (fast native scan). */
  getHeatmapCacheSize(basePath: string): number {
    if (!this.ready) return 0;
    const normalizedPath = basePath.startsWith('file://') ? basePath.slice(7) : basePath;
    return Number(
      this.timed('getHeatmapCacheSize', () =>
        this.engine.heatmap().getCacheSize(normalizedPath)
      )
    );
  }

  /** Clear all heatmap tiles from disk. */
  clearHeatmapTiles(basePath: string): number {
    if (!this.ready) return 0;
    // Normalize file:// URLs — Rust expects plain filesystem paths
    const normalizedPath = basePath.startsWith('file://') ? basePath.slice(7) : basePath;
    return this.timed('clearHeatmapTiles', () =>
      this.engine.heatmap().clearTiles(normalizedPath)
    );
  }

  /** Get heatmap tile generation progress: [processed, total] */
  getHeatmapTileProgress(): number[] | null {
    if (!this.ready) return null;
    try {
      return this.engine.heatmap().getProgress();
    } catch {
      return null;
    }
  }

  /** Poll tile generation status: 'idle' | 'running' | 'complete' */
  pollTileGeneration(): string {
    if (!this.ready) return 'idle';
    try {
      return this.engine.heatmap().poll();
    } catch {
      return 'error';
    }
  }

  // ==========================================================================
  // Activity Pattern Detection (K-means clustering)
  // ==========================================================================

  /**
   * Get activity patterns detected via k-means clustering on activity features.
   * Returns patterns meeting confidence >= 0.6 threshold.
   * K-means on [day_of_week, duration, TSS, distance] per sport type.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getActivityPatterns(): any[] {
    if (!this.ready) return [];
    return this.timed('getActivityPatterns', () =>
      this.engine.fitness().getActivityPatterns(),
    );
  }

  /**
   * Get the highest-confidence pattern matching today's day_of_week + season.
   * Convenience method for Feed tab teaser (avoids loading all patterns in JS).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPatternForToday(): any | undefined {
    if (!this.ready) return undefined;
    return this.timed('getPatternForToday', () =>
      this.engine.fitness().getPatternForToday() ?? undefined,
    );
  }

  // ==========================================================================
  // Athlete Profile & Sport Settings Cache
  // ==========================================================================

  setAthleteProfile(json: string): void {
    if (!this.ready) return;
    try {
      this.timed('setAthleteProfile', () => this.engine.settings().setAthleteProfile(json));
    } catch {
      // Settings write failed — non-critical
    }
  }

  getAthleteProfile(): string {
    if (!this.ready) return '';
    try {
      return this.timed('getAthleteProfile', () => this.engine.settings().getAthleteProfile()) ?? '';
    } catch {
      return '';
    }
  }

  setSportSettings(json: string): void {
    if (!this.ready) return;
    try {
      this.timed('setSportSettings', () => this.engine.settings().setSportSettings(json));
    } catch {
      // Settings write failed — non-critical
    }
  }

  getSportSettings(): string {
    if (!this.ready) return '';
    try {
      return this.timed('getSportSettings', () => this.engine.settings().getSportSettings()) ?? '';
    } catch {
      return '';
    }
  }

  // ==========================================================================
  // User Preferences (SQLite settings table)
  // ==========================================================================

  getSetting(key: string): string | undefined {
    if (!this.ready) return undefined;
    try {
      return this.engine.settings().getSetting(key) ?? undefined;
    } catch {
      return undefined;
    }
  }

  setSetting(key: string, value: string): void {
    if (!this.ready) return;
    try {
      this.engine.settings().setSetting(key, value);
    } catch {
      // Settings write failed — non-critical
    }
  }

  getAllSettings(): Record<string, string> {
    if (!this.ready) return {};
    try {
      const json = this.engine.settings().getAllSettings();
      return JSON.parse(json) as Record<string, string>;
    } catch {
      return {};
    }
  }

  setAllSettings(settings: Record<string, string>): void {
    if (!this.ready) return;
    try {
      this.engine.settings().setAllSettings(JSON.stringify(settings));
    } catch {
      // Settings write failed — non-critical
    }
  }

  deleteSetting(key: string): void {
    if (!this.ready) return;
    try {
      this.engine.settings().deleteSetting(key);
    } catch {
      // Settings delete failed — non-critical
    }
  }

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
      gen().computePolylineOverlap(coordsA, coordsB, thresholdMeters),
    );
  }

  getSectionsByType(sectionType?: 'auto' | 'custom'): FfiSection[] {
    if (!this.ready) return [];
    return this.timed('getSectionsByType', () =>
      this.engine.sections().getByType(sectionType),
    );
  }

  createSectionFromIndices(
    activityId: string,
    startIndex: number,
    endIndex: number,
    sportType: string,
    name?: string,
  ): string {
    if (!this.ready) return '';
    validateId(activityId, 'activity ID');

    const track = this.getGpsTrack(activityId);
    if (!track || track.length === 0) {
      throw new Error(`No GPS track found for activity ${activityId}`);
    }

    const sectionTrack = track.slice(startIndex, endIndex + 1);
    if (sectionTrack.length < 2) {
      throw new Error('Section must have at least 2 points');
    }

    const sectionId = this.timed('createSection', () =>
      this.engine.sections().create(
        sportType,
        sectionTrack,
        0.0,
        name || undefined,
        activityId,
        startIndex,
        endIndex,
      ),
    );

    if (sectionId) {
      this.notify('sections');
    }

    return sectionId;
  }

  deleteSection(sectionId: string): boolean {
    if (!this.ready) return false;
    validateId(sectionId, 'section ID');
    try {
      this.timed('deleteSection', () => this.engine.sections().delete_(sectionId));
      this.notify('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] deleteSection failed:', sectionId, e);
      return false;
    }
  }

  disableSection(sectionId: string): boolean {
    if (!this.ready) return false;
    try {
      this.engine.sections().disable(sectionId);
      this.notify('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] disableSection failed:', sectionId, e);
      return false;
    }
  }

  enableSection(sectionId: string): boolean {
    if (!this.ready) return false;
    try {
      this.engine.sections().enable(sectionId);
      this.notify('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] enableSection failed:', sectionId, e);
      return false;
    }
  }

  setSuperseded(autoSectionId: string, customSectionId: string): boolean {
    if (!this.ready) return false;
    try {
      this.engine.sections().setSuperseded(autoSectionId, customSectionId);
      return true;
    } catch (e) {
      console.error('[RouteEngine] setSuperseded failed:', autoSectionId, e);
      return false;
    }
  }

  clearSuperseded(customSectionId: string): boolean {
    if (!this.ready) return false;
    try {
      this.engine.sections().clearSuperseded(customSectionId);
      this.notify('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] clearSuperseded failed:', customSectionId, e);
      return false;
    }
  }

  importDisabledIds(ids: string[]): number {
    if (!this.ready || ids.length === 0) return 0;
    try {
      return this.engine.sections().importDisabledIds(ids);
    } catch (e) {
      console.error('[RouteEngine] importDisabledIds failed:', e);
      return 0;
    }
  }

  importSupersededMap(map: Record<string, string[]>): number {
    if (!this.ready) return 0;
    const entries = Object.entries(map).map(([customSectionId, autoSectionIds]) => ({
      customSectionId,
      autoSectionIds,
    }));
    if (entries.length === 0) return 0;
    try {
      return this.engine.sections().importSupersededMap(entries);
    } catch (e) {
      console.error('[RouteEngine] importSupersededMap failed:', e);
      return 0;
    }
  }

  getAllSectionsIncludingHidden(sportType?: string): SectionSummary[] {
    if (!this.ready) return [];
    return this.timed('getAllSectionsIncludingHidden', () =>
      this.engine.sections().getAllSummariesIncludingHidden(sportType ?? null),
    );
  }

  detectPotentials(sportFilter?: string): FfiPotentialSection[] {
    if (!this.ready) return [];
    return this.timed('detectPotentials', () =>
      this.engine.detection().detectPotentials(sportFilter),
    );
  }

  extractSectionTrace(activityId: string, sectionPolylineJson: string): FfiGpsPoint[] {
    if (!this.ready) return [];
    validateId(activityId, 'activity ID');
    const flatCoords = this.timed('extractSectionTrace', () =>
      this.engine.sections().extractTrace(activityId, sectionPolylineJson),
    );
    return flatCoordsToPoints(flatCoords);
  }

  extractSectionTracesBatch(
    activityIds: string[],
    sectionPolylineJson: string,
  ): Record<string, RoutePoint[]> {
    if (!this.ready || activityIds.length === 0) return {};
    const results = this.timed('extractSectionTracesBatch', () =>
      this.engine.sections().extractTracesBatch(activityIds, sectionPolylineJson),
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

  getActivityMetricsForIds(ids: string[]): FfiActivityMetrics[] {
    if (!this.ready || ids.length === 0) return [];
    return this.timed('getActivityMetricsForIds', () =>
      this.engine.activities().getMetricsForIds(ids),
    );
  }

  setSectionReference(sectionId: string, activityId: string): boolean {
    if (!this.ready) return false;
    validateId(sectionId, 'section ID');
    validateId(activityId, 'activity ID');
    try {
      this.timed('setSectionReference', () =>
        this.engine.sections().setReference(sectionId, activityId),
      );
      this.notify('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] setSectionReference failed:', sectionId, activityId, e);
      return false;
    }
  }

  resetSectionReference(sectionId: string): boolean {
    if (!this.ready) return false;
    validateId(sectionId, 'section ID');
    try {
      this.timed('resetSectionReference', () =>
        this.engine.sections().resetReference(sectionId),
      );
      this.notify('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] resetSectionReference failed:', sectionId, e);
      return false;
    }
  }

  getSectionReferenceInfo(sectionId: string): { activityId?: string; isUserDefined: boolean } {
    if (!this.ready) return { activityId: undefined, isUserDefined: false };
    validateId(sectionId, 'section ID');
    const info = this.timed('getSectionReferenceInfo', () =>
      this.engine.sections().getReferenceInfo(sectionId),
    );
    return { activityId: info?.activityId, isUserDefined: info?.isUserDefined ?? false };
  }

  // ==========================================================================
  // Section Bounds Trimming
  // ==========================================================================

  trimSection(sectionId: string, startIndex: number, endIndex: number): boolean {
    if (!this.ready) return false;
    validateId(sectionId, 'section ID');
    try {
      this.timed('trimSection', () =>
        this.engine.sections().trim(sectionId, startIndex, endIndex),
      );
      this.notifyAll('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] trimSection failed:', sectionId, { startIndex, endIndex }, e);
      return false;
    }
  }

  resetSectionBounds(sectionId: string): boolean {
    if (!this.ready) return false;
    validateId(sectionId, 'section ID');
    try {
      this.timed('resetSectionBounds', () => this.engine.sections().resetBounds(sectionId));
      this.notifyAll('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] resetSectionBounds failed:', sectionId, e);
      return false;
    }
  }

  hasOriginalBounds(sectionId: string): boolean {
    if (!this.ready) return false;
    validateId(sectionId, 'section ID');
    return this.timed('hasOriginalBounds', () =>
      this.engine.sections().hasOriginalBounds(sectionId),
    );
  }

  /**
   * Get the representative activity's full GPS track for section expansion.
   * Returns the track as flat coords [lat, lng, ...] + section start/end indices.
   */
  getSectionExtensionTrack(
    sectionId: string,
  ): { track: number[]; sectionStartIdx: number; sectionEndIdx: number } | null {
    if (!this.ready) return null;
    validateId(sectionId, 'section ID');
    try {
      return this.timed('getSectionExtensionTrack', () => {
        const result = this.engine.sections().getExtensionTrack(sectionId);
        return {
          track: result.track,
          sectionStartIdx: result.sectionStartIdx,
          sectionEndIdx: result.sectionEndIdx,
        };
      });
    } catch (e) {
      console.error('[RouteEngine] getSectionExtensionTrack failed:', sectionId, e);
      return null;
    }
  }

  /**
   * Expand section bounds by providing a new polyline (can be larger than original).
   * Backs up original polyline on first edit, re-matches activities.
   */
  expandSectionBounds(sectionId: string, newPolylineJson: string): boolean {
    if (!this.ready) return false;
    validateId(sectionId, 'section ID');
    try {
      this.timed('expandSectionBounds', () =>
        this.engine.sections().expandBounds(sectionId, newPolylineJson),
      );
      this.notifyAll('sections');
      return true;
    } catch (e) {
      console.error('[RouteEngine] expandSectionBounds failed:', sectionId, e);
      return false;
    }
  }

  getDownloadProgress(): DownloadProgressResult {
    return gen().getDownloadProgress();
  }

  removeActivity(activityId: string): boolean {
    if (!this.ready) return false;
    try {
      this.timed('removeActivity', () => this.engine.activities().remove(activityId));
      this.notifyAll('activities', 'groups', 'sections');
      return true;
    } catch {
      return false;
    }
  }

  debugCloneActivity(sourceId: string, count: number): number {
    if (!this.ready) return 0;
    const created = this.timed('debugCloneActivity', () =>
      this.engine.activities().debugClone(sourceId, count),
    );
    if (created > 0) {
      this.notifyAll('activities', 'groups', 'sections');
    }
    return created;
  }

  // ========================================================================
  // Strength Training
  // ========================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getExerciseSets(activityId: string): any[] {
    return this.timed('getExerciseSets', () =>
      this.engine.strength().getExerciseSets(activityId),
    );
  }

  isFitProcessed(activityId: string): boolean {
    return this.timed('isFitProcessed', () =>
      this.engine.strength().isFitProcessed(activityId),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchAndParseExerciseSets(authHeader: string, activityId: string): any[] {
    return this.timed('fetchAndParseExerciseSets', () =>
      this.engine.strength().fetchAndParseExerciseSets(authHeader, activityId),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMuscleGroups(activityId: string): any[] {
    return this.timed('getMuscleGroups', () =>
      this.engine.strength().getMuscleGroups(activityId),
    );
  }

  getUnprocessedStrengthIds(activityIds: string[]): string[] {
    return this.timed('getUnprocessedStrengthIds', () =>
      this.engine.strength().getUnprocessedStrengthIds(activityIds),
    );
  }

  batchFetchExerciseSets(authHeader: string, activityIds: string[]): string[] {
    return this.timed('batchFetchExerciseSets', () =>
      this.engine.strength().batchFetchExerciseSets(authHeader, activityIds),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getStrengthSummary(startTs: number, endTs: number): any {
    return this.timed('getStrengthSummary', () =>
      this.engine.strength().getStrengthSummary(BigInt(startTs), BigInt(endTs)),
    );
  }

  hasStrengthData(): boolean {
    return this.timed('hasStrengthData', () => this.engine.strength().hasStrengthData());
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getExercisesForMuscle(startTs: number, endTs: number, muscleSlug: string): any {
    return this.timed('getExercisesForMuscle', () =>
      this.engine
        .strength()
        .getExercisesForMuscle(BigInt(startTs), BigInt(endTs), muscleSlug),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getActivitiesForExercise(
    startTs: number,
    endTs: number,
    muscleSlug: string,
    exerciseCategory: number,
  ): any {
    return this.timed('getActivitiesForExercise', () =>
      this.engine
        .strength()
        .getActivitiesForExercise(BigInt(startTs), BigInt(endTs), muscleSlug, exerciseCategory),
    );
  }

  // ========================================================================
  // Section Matching, Nearby, Merge, Re-detect
  // ========================================================================

  matchActivityToSections(activityId: string): FfiSectionMatch[] {
    if (!this.ready) return [];
    validateId(activityId, 'activity ID');
    return this.timed('matchActivityToSections', () =>
      this.engine.sections().matchActivityToSections(activityId),
    );
  }

  rematchActivityToSection(activityId: string, sectionId: string): boolean {
    if (!this.ready) return false;
    validateId(activityId, 'activity ID');
    validateId(sectionId, 'section ID');
    try {
      const result = this.timed('rematchActivityToSection', () =>
        this.engine.sections().rematchActivityToSection(activityId, sectionId),
      );
      if (result) {
        this.notify('sections');
      }
      return result;
    } catch (e) {
      console.error('[RouteEngine] rematchActivityToSection failed:', e);
      return false;
    }
  }

  getNearbySections(sectionId: string, radiusMeters: number = 500): FfiNearbySectionSummary[] {
    if (!this.ready) return [];
    validateId(sectionId, 'section ID');
    return this.timed('getNearbySections', () =>
      this.engine.sections().getNearbySections(sectionId, radiusMeters),
    );
  }

  getMergeCandidates(sectionId: string): FfiMergeCandidate[] {
    if (!this.ready) return [];
    validateId(sectionId, 'section ID');
    return this.timed('getMergeCandidates', () =>
      this.engine.sections().getMergeCandidates(sectionId),
    );
  }

  mergeSections(primaryId: string, secondaryId: string): string | null {
    if (!this.ready) return null;
    validateId(primaryId, 'primary section ID');
    validateId(secondaryId, 'secondary section ID');
    try {
      const result = this.timed('mergeSections', () =>
        this.engine.sections().mergeSections(primaryId, secondaryId),
      );
      this.notify('sections');
      return result;
    } catch (e) {
      console.error('[RouteEngine] mergeSections failed:', e);
      return null;
    }
  }

  getActivitySectionHighlights(activityIds: string[]): FfiActivitySectionHighlight[] {
    if (!this.ready || activityIds.length === 0) return [];
    return this.timed('getActivitySectionHighlights', () =>
      this.engine.sections().getActivitySectionHighlights(activityIds),
    );
  }

  getActivityRouteHighlights(activityIds: string[]): FfiActivityRouteHighlight[] {
    if (!this.ready || activityIds.length === 0) return [];
    return this.timed('getActivityRouteHighlights', () =>
      this.engine.routes().getActivityRouteHighlights(activityIds),
    );
  }

  forceRedetectSections(sportFilter?: string): boolean {
    if (!this.ready) return false;
    try {
      const started = this.timed('forceRedetectSections', () =>
        this.engine.detection().forceRedetect(sportFilter),
      );
      return started;
    } catch (e) {
      console.error('[RouteEngine] forceRedetectSections failed:', e);
      return false;
    }
  }

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

  private notify(event: string): void {
    this.listeners.get(event)?.forEach((cb) => cb());
  }

  private notifyAll(...events: string[]): void {
    events.forEach((event) => this.notify(event));
  }
}

export { RouteEngineClient };
