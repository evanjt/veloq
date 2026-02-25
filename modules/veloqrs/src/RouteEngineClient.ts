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
  FfiGpsPoint,
  FfiRouteGroup,
  FfiFrequentSection,
  FfiSection,
  FfiSectionPerformanceResult,
  FfiCalendarSummary,
  FfiRoutePerformanceResult,
  SectionSummary,
  GroupSummary,
  MapActivityComplete,
  FfiPeriodStats,
  FfiFtpTrend,
  FfiPaceTrend,
  FfiRoutesScreenData,
  DownloadProgressResult,
} from './generated/veloqrs';

import {
  flatCoordsToPoints,
  validateId,
  validateName,
  type RoutePoint,
  type SectionDetectionProgress,
  type RawPotentialSection,
} from './conversions';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const gen = (): any => require('./generated/veloqrs');

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

  clear(): void {
    this.timed('clear', () => this.engine?.clear());
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
    this.timed('markForRecomputation', () => this.engine.markForRecomputation());
  }

  startSectionDetection(sportFilter?: string): boolean {
    if (!this.ready) return false;
    return this.timed('startSectionDetection', () => this.engine.detection().start(sportFilter));
  }

  pollSectionDetection(): string {
    if (!this.ready) return 'idle';
    const status = this.timed('pollSectionDetection', () => this.engine.detection().poll());
    if (status === 'complete') {
      this.notify('sections');
    }
    return status;
  }

  getSectionDetectionProgress(): SectionDetectionProgress | null {
    if (!this.ready) return null;
    try {
      const json = this.timed('getSectionDetectionProgress', () =>
        this.engine.detection().getProgress(),
      );
      if (!json || json === '{}') return null;
      const data = JSON.parse(json) as {
        phase?: string;
        completed?: number;
        total?: number;
      };
      if (!data.phase) return null;
      return {
        phase: data.phase,
        completed: data.completed ?? 0,
        total: data.total ?? 0,
      };
    } catch {
      return null;
    }
  }

  getGroups(): FfiRouteGroup[] {
    if (!this.ready) return [];
    return this.timed('getGroups', () => this.engine.routes().getAll());
  }

  getSections(): FfiFrequentSection[] {
    if (!this.ready) return [];
    return this.timed('getSections', () => this.engine.sections().getAll());
  }

  getSectionCount(): number {
    if (!this.ready) return 0;
    return this.timed('getSectionCount', () => this.engine.sections().getCount(undefined));
  }

  getSectionsForActivity(activityId: string): FfiSection[] {
    if (!this.ready) return [];
    return this.timed('getSectionsForActivity', () =>
      this.engine.sections().getForActivity(activityId),
    );
  }

  getGroupCount(): number {
    if (!this.ready) return 0;
    return this.timed('getGroupCount', () => this.engine.routes().getCount());
  }

  getSectionSummaries(): SectionSummary[] {
    if (!this.ready) return [];
    return this.timed('getSectionSummaries', () =>
      this.engine.sections().getSummaries(undefined),
    );
  }

  getSectionSummariesForSport(sportType: string): SectionSummary[] {
    if (!this.ready) return [];
    return this.timed('getSectionSummariesForSport', () =>
      this.engine.sections().getSummaries(sportType),
    );
  }

  getGroupSummaries(): GroupSummary[] {
    if (!this.ready) return [];
    return this.timed('getGroupSummaries', () => this.engine.routes().getSummaries());
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
    const flatCoords = this.timed('getSectionPolyline', () =>
      this.engine.sections().getPolyline(sectionId),
    );
    return flatCoordsToPoints(flatCoords);
  }

  getMapActivitiesFiltered(
    startDate: Date,
    endDate: Date,
    sportTypesArray?: string[],
  ): MapActivityComplete[] {
    if (!this.ready) return [];
    const startTs = BigInt(Math.floor(startDate.getTime() / 1000));
    const endTs = BigInt(Math.floor(endDate.getTime() / 1000));
    const sportTypesJson = sportTypesArray?.length ? JSON.stringify(sportTypesArray) : '';
    return this.timed('getMapActivitiesFiltered', () =>
      this.engine.maps().getFiltered(startTs, endTs, sportTypesJson),
    );
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

  setSectionName(sectionId: string, name: string): void {
    if (!this.ready) return;
    validateId(sectionId, 'section ID');
    validateName(name, 'section name');
    this.timed('setSectionName', () => this.engine.sections().setName(sectionId, name));
    this.notify('sections');
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
    const flatCoords = this.timed('getGpsTrack', () =>
      this.engine.activities().getGpsTrack(activityId),
    );
    return flatCoordsToPoints(flatCoords);
  }

  getConsensusRoute(groupId: string): FfiGpsPoint[] {
    if (!this.ready) return [];
    validateId(groupId, 'group ID');
    const flatCoords = this.timed('getConsensusRoute', () =>
      this.engine.routes().getConsensusRoute(groupId),
    );
    return flatCoordsToPoints(flatCoords);
  }

  getRoutePerformances(
    routeGroupId: string,
    currentActivityId: string,
  ): FfiRoutePerformanceResult {
    if (!this.ready) {
      return {
        performances: [],
        activityMetrics: [],
        best: undefined,
        bestForward: undefined,
        bestReverse: undefined,
        forwardStats: undefined,
        reverseStats: undefined,
        currentRank: undefined,
      } as unknown as FfiRoutePerformanceResult;
    }
    validateId(routeGroupId, 'route group ID');
    if (currentActivityId !== '') {
      validateId(currentActivityId, 'activity ID');
    }
    return this.timed('getRoutePerformances', () =>
      this.engine.routes().getPerformances(routeGroupId, currentActivityId || undefined),
    );
  }

  getSectionPerformances(sectionId: string): FfiSectionPerformanceResult {
    if (!this.ready) {
      return {
        records: [],
        bestRecord: undefined,
        bestForwardRecord: undefined,
        bestReverseRecord: undefined,
        forwardStats: undefined,
        reverseStats: undefined,
      } as unknown as FfiSectionPerformanceResult;
    }
    return this.timed('getSectionPerformances', () =>
      this.engine.sections().getPerformances(sectionId),
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
    return this.timed('getStats', () => this.engine.getStats());
  }

  getRoutesScreenData(
    groupLimit = 20,
    groupOffset = 0,
    sectionLimit = 20,
    sectionOffset = 0,
    minGroupActivityCount = 2,
  ): FfiRoutesScreenData | undefined {
    if (!this.ready) return undefined;
    return this.timed('getRoutesScreenData', () =>
      this.engine
        .routes()
        .getScreenData(groupLimit, groupOffset, sectionLimit, sectionOffset, minGroupActivityCount),
    );
  }

  getPeriodStats(startTs: number, endTs: number): FfiPeriodStats {
    if (!this.ready) return { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 } as unknown as FfiPeriodStats;
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
    if (!this.ready) return { latestFtp: undefined, latestDate: undefined, previousFtp: undefined, previousDate: undefined } as unknown as FfiFtpTrend;
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
    this.timed('savePaceSnapshot', () =>
      this.engine.fitness().savePaceSnapshot(sportType, criticalSpeed, dPrime, r2, BigInt(ts)),
    );
  }

  getPaceTrend(sportType: string): FfiPaceTrend {
    if (!this.ready) return { latestPace: undefined, latestDate: undefined, previousPace: undefined, previousDate: undefined } as unknown as FfiPaceTrend;
    return this.timed('getPaceTrend', () => this.engine.fitness().getPaceTrend(sportType));
  }

  getAvailableSportTypes(): string[] {
    if (!this.ready) return [];
    return this.timed('getAvailableSportTypes', () =>
      this.engine.fitness().getAvailableSportTypes(),
    );
  }

  setAthleteProfile(json: string): void {
    if (!this.ready) return;
    this.timed('setAthleteProfile', () => this.engine.settings().setAthleteProfile(json));
  }

  getAthleteProfile(): string {
    if (!this.ready) return '';
    return this.timed('getAthleteProfile', () => this.engine.settings().getAthleteProfile());
  }

  setSportSettings(json: string): void {
    if (!this.ready) return;
    this.timed('setSportSettings', () => this.engine.settings().setSportSettings(json));
  }

  getSportSettings(): string {
    if (!this.ready) return '';
    return this.timed('getSportSettings', () => this.engine.settings().getSportSettings());
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
        JSON.stringify(sectionTrack),
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
    const result = this.timed('deleteSection', () =>
      this.engine.sections().delete(sectionId),
    );
    if (result) {
      this.notify('sections');
    }
    return result;
  }

  detectPotentials(sportFilter?: string): RawPotentialSection[] {
    if (!this.ready) return [];
    const json = this.timed('detectPotentials', () =>
      this.engine.detection().detectPotentials(sportFilter),
    );
    if (!json) return [];
    try {
      return JSON.parse(json) as RawPotentialSection[];
    } catch {
      return [];
    }
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
    const result = this.timed('setSectionReference', () =>
      this.engine.sections().setReference(sectionId, activityId),
    );
    if (result) {
      this.notify('sections');
    }
    return result;
  }

  resetSectionReference(sectionId: string): boolean {
    if (!this.ready) return false;
    validateId(sectionId, 'section ID');
    const result = this.timed('resetSectionReference', () =>
      this.engine.sections().resetReference(sectionId),
    );
    if (result) {
      this.notify('sections');
    }
    return result;
  }

  getSectionReference(sectionId: string): string | undefined {
    if (!this.ready) return undefined;
    validateId(sectionId, 'section ID');
    const info = this.timed('getSectionReference', () =>
      this.engine.sections().getReferenceInfo(sectionId),
    );
    return info?.activityId;
  }

  isSectionReferenceUserDefined(sectionId: string): boolean {
    if (!this.ready) return false;
    validateId(sectionId, 'section ID');
    const info = this.timed('isSectionReferenceUserDefined', () =>
      this.engine.sections().getReferenceInfo(sectionId),
    );
    return info?.isUserDefined ?? false;
  }

  getDownloadProgress(): DownloadProgressResult {
    return gen().getDownloadProgress();
  }

  removeActivity(activityId: string): boolean {
    if (!this.ready) return false;
    const removed = this.timed('removeActivity', () =>
      this.engine.activities().remove(activityId),
    );
    if (removed) {
      this.notifyAll('activities', 'groups', 'sections');
    }
    return removed;
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
