/**
 * Stand-in for the Rust engine binding. The real module registers a TurboModule
 * at import time, which throws outside a native runtime, so any component that
 * transitively imports it cannot be rendered without this.
 *
 * Only the value exports need a body. Types are erased before Jest sees them.
 *
 * A test that needs one method to behave differently overrides it rather than
 * writing its own module:
 *
 *     jest.mock('veloqrs', () =>
 *       require('../../__shared__/veloqrsStub').withOverrides({
 *         decodeCoords: () => [{ latitude: 1, longitude: 2 }],
 *       })
 *     );
 */

// The real check, not a copy: the delegate holds no native import.
import { isRouteNameTakenError } from '../../../modules/veloqrs/src/delegates/routes';

/**
 * `FfiCallKind` as the generated binding declares it. The generated module
 * cannot be imported here, so this is a copy, and `ffiEnumStub.test.ts` reads
 * the generated source to hold it to the real one.
 */
export enum CallKind {
  Ok = 1,
  Unauthorized = 2,
  RateLimited = 3,
  Http = 4,
  Network = 5,
  Internal = 6,
  OtherAthlete = 7,
}

/** `FfiUploadOutcome` as generated, held to the source by the same test. */
export enum UploadOutcome {
  Uploaded = 1,
  PermissionBlocked = 2,
  AuthExpired = 3,
  Rejected = 4,
  Retriable = 5,
  Network = 6,
  Missing = 7,
  OtherAthlete = 8,
  NotStarted = 9,
}

/** `FfiSyncErrorReason` as generated, held to the source by the same test. */
export enum SyncErrorReason {
  Unauthorized = 1,
  RateLimited = 2,
  Server = 3,
  Network = 4,
  Storage = 5,
  NotConfigured = 6,
  Internal = 7,
  EngineClosed = 8,
  StorageFull = 9,
}

/** `FfiSyncStep` as generated, held to the source by the same test. */
export enum SyncStep {
  Athlete = 1,
  SportSettings = 2,
  Wellness = 3,
  Census = 4,
  Activities = 5,
  Curves = 6,
  IntervalBodies = 7,
  RemainingActivities = 8,
  FirstActivities = 9,
  RecordActivities = 10,
  Calendar = 11,
}

/** `FfiTrackStep` as generated, held to the source by the same test. */
export enum TrackStep {
  Downloading = 1,
  Analysing = 2,
  DrawingHeatmap = 3,
}

/** `FfiGroupSort` as generated, held to the source by the same test. */
export enum GroupSort {
  Nearby = 0,
  Activities = 1,
  Distance = 2,
  Name = 3,
}

/** `FfiSportFamily` as generated, the families as the engine names them. */
export enum EngineSportFamily {
  Ride = 0,
  Winter = 1,
  Run = 2,
  Water = 3,
  Foot = 4,
  Strength = 5,
  Other = 6,
}

/** `FfiIntervalKind` as generated, what intervals.icu calls a lap. */
export enum IntervalKind {
  Work = 0,
  Recovery = 1,
  Rest = 2,
  Warmup = 3,
  Cooldown = 4,
  ActiveRecovery = 5,
  Other = 6,
}

export enum MapDistanceBand {
  All,
  XShort,
  Short,
  Medium,
  Long,
}

export enum EfficiencyDirection {
  Improving,
  Flat,
  Worsening,
}

/** `FfiOffScale` as generated, where a scatter point lies against its focus range. */
export enum FfiOffScale {
  None,
  Slow,
  Fast,
}

/** `FfiLoadMetric` as generated, the metric a period comparison was taken on. */
export enum LoadMetric {
  Tss = 0,
  Duration = 1,
}

/** `FfiDayLoadStatus` as generated, whether a day's recorded load can be totalled. */
export enum DayLoadStatus {
  Complete = 0,
  Partial = 1,
  Unavailable = 2,
  Rest = 3,
}

/** `FfiBestEffortKind` as generated, what a best effort's checkpoint measures. */
export enum BestEffortKind {
  Duration = 0,
  Distance = 1,
  HalfMarathon = 2,
}

/** `FfiMaxHrSource` as generated, where an activity's max HR came from. */
export enum MaxHrSource {
  ActivityZones = 0,
  SportSettings = 1,
  Default = 2,
}

/** `FfiPoolSwimState` as generated, where a pool swim's lengths stand. */
export enum PoolSwimState {
  Owed = 1,
  Read = 2,
  NoLengths = 3,
}

/** `FfiPoolUnit` as generated, the unit a pool is measured in. */
export enum PoolUnit {
  Metres = 1,
  Yards = 2,
}

/** `FfiCadenceUnit` as generated, the unit an activity's cadence crosses in. */
export enum CadenceUnit {
  Rpm = 0,
  StepsPerMinute = 1,
  StrokesPerMinute = 2,
}

/** `FfiSectionSort` as generated, held to the source by the same test. */
export enum SectionSort {
  Nearby = 0,
  Signature = 1,
  Visits = 2,
  Distance = 3,
  Name = 4,
}

/** `BulkExportFormat` as generated, held to the source by the same test. */
export enum BulkExportFormat {
  Gpx = 1,
  GeoJson = 2,
}

/** `RecordScope` as generated, held to the source by the same test. */
export enum RecordScope {
  Whole = 1,
  SharedStorage = 2,
}

/** `DownloadPriority` as generated, held to the source by the same test. */
export enum DownloadPriority {
  Interactive = 0,
  Bulk = 1,
}

/** `SyncState` as generated, held to the source by the same test. */
export enum SyncState {
  Idle = 1,
  Syncing = 2,
  Paused = 3,
  AuthExpired = 4,
}

/** `FfiInitOutcome` as generated, held to the source by the same test. */
export enum InitOutcome {
  Opened = 1,
  Busy = 2,
  ForwardSchema = 3,
  StorageUnavailable = 4,
  NotAttempted = 5,
  Failed = 6,
  VersionMismatch = 7,
}

/** `FfiStartOutcome` as generated, held to the source by the same test. */
export enum StartOutcome {
  Started = 1,
  Busy = 2,
  Held = 3,
  NotReady = 4,
  NotConfigured = 5,
  NotOwed = 6,
  Failed = 7,
  Offline = 8,
}

/** `FfiRetiredPairLink` as generated, held to the source by the same test. */
export enum RetiredPairLink {
  Ledger,
  Supersedes,
  Ground,
}

/** `RangeCoverage` as generated, held to the source by the same test. */
export enum RangeCoverage {
  Empty = 1,
  NotFetched = 2,
  Loaded = 3,
}

/** `GarminKeyStatus` as generated, held to the source by the same test. */
export enum GarminKeyStatus {
  Connected,
  Rejected,
  Malformed,
  Unreachable,
}

/** `FfiPlannedCategory` as generated, held to the source by the same test. */
export enum FfiPlannedCategory {
  Workout,
  Race,
  Note,
  Target,
  Season,
  Other,
}

/** `FfiPlanTarget` as generated, held to the source by the same test. */
export enum FfiPlanTarget {
  Power,
  HeartRate,
  Pace,
}

/** `FfiPlanLineKind` as generated, held to the source by the same test. */
export enum FfiPlanLineKind {
  Work,
  Rest,
}

/** `FfiTargetMetric` as generated, held to the source by the same test. */
export enum FfiTargetMetric {
  Power,
  HeartRate,
  Pace,
}

/** `FfiAbsoluteUnits` as generated, held to the source by the same test. */
export enum FfiAbsoluteUnits {
  Watts,
  Bpm,
}

/** `FfiReferenceSource` as generated, held to the source by the same test. */
export enum FfiReferenceSource {
  Record,
  AthleteSet,
  PreviousRecord,
  Typical,
}

/** The tags of `FfiCatalogueEmptyReason` as generated, held to the source by the same test. */
export enum FfiCatalogueEmptyReason_Tags {
  NoGpsActivities = 'NoGpsActivities',
  NotYetRun = 'NotYetRun',
  Running = 'Running',
  Held = 'Held',
  NoneFound = 'NoneFound',
}

/** The tags of `FfiMapEmptyReason` as generated, held to the source by the same test. */
export enum FfiMapEmptyReason_Tags {
  NoActivities = 'NoActivities',
  Filtered = 'Filtered',
  TracksPending = 'TracksPending',
  NoGps = 'NoGps',
}

/** The tags of `FfiDetectionHold` as generated, held to the source by the same test. */
export enum FfiDetectionHold_Tags {
  ElevationPaused = 'ElevationPaused',
  ElevationRunning = 'ElevationRunning',
  ElevationWaiting = 'ElevationWaiting',
  Cutover = 'Cutover',
}

export const startOutcome = (result: StartOutcome | { outcome: StartOutcome }): StartOutcome =>
  typeof result === 'object' ? result.outcome : result;

export const isRetryableStart = (result: StartOutcome | { outcome: StartOutcome }): boolean => {
  const outcome = startOutcome(result);
  return (
    outcome === StartOutcome.Busy ||
    outcome === StartOutcome.Held ||
    outcome === StartOutcome.NotReady ||
    outcome === StartOutcome.Offline
  );
};

export const hasStarted = (result: StartOutcome | { outcome: StartOutcome }): boolean =>
  startOutcome(result) === StartOutcome.Started;

export const isRetryableInit = (outcome: InitOutcome): boolean => outcome === InitOutcome.Busy;

export const hasOpened = (outcome: InitOutcome): boolean => outcome === InitOutcome.Opened;

export const decodeCoords = jest.fn(
  () => [] as { latitude: number; longitude: number; elevation?: number }[]
);

export const decodeCoordsFlat = jest.fn(() => new Float64Array(0));

/** Fresh jest.fn PreviewClient, one per test, defaulting to an idle engine. */
export const createPreviewClientStub = () => ({
  subscribe: jest.fn(() => () => {}),
  getPreviewCentres: jest.fn(() => []),
  getPreviewCurrentSections: jest.fn(() => []),
  startPreviewDetect: jest.fn(() => StartOutcome.NotReady),
  pollPreviewDetect: jest.fn(() => 'idle'),
  getPreviewProgress: jest.fn(() => null),
  takePreviewResult: jest.fn(() => null),
  cancelPreviewDetect: jest.fn(),
  getSectionConfig: jest.fn(() => null),
  setSectionConfig: jest.fn(),
  forceRedetectSections: jest.fn(() => StartOutcome.Held),
});
export const takeFetchAndStoreResult = jest.fn(() => undefined);
export const cancelFetchAndStore = jest.fn(() => true);
export const getFetchRunProgress = jest.fn(() => ({ active: false, completed: 0, total: 0 }));
/** Readying one activity's owed bodies, answering that it still owes them. */
export const readyActivityBodies = jest.fn(async (_activityId: string) => false);
/** A GPS pass the engine started, as run 0 over the ids it was handed. */
export const startGpsPass = jest.fn((_oldest?: string, _newest?: string, head: string[] = []) => ({
  outcome: StartOutcome.Started,
  run: 0,
  total: head.length,
}));
/** The fetch-and-store calls as the engine client carries them, for a test that overrides `engine`. */
export const fetchCalls = {
  startGpsPass,
  takeFetchAndStoreResult,
  cancelFetchAndStore,
  getFetchRunProgress,
  readyActivityBodies,
};

/**
 * A closed engine, which is what a Jest run has: `ready` is false and every
 * read answers undefined, so a caller falls through to its own fallback the
 * way it does before `initWithPath`. An engine object that exists but answers
 * nothing throws instead, and reads as a wrong value rather than as absent.
 */
export const engine = {
  ready: false,
  // The sync status reader subscribes on the first mount that wants it, so a
  // closed engine still has to hand back an unsubscribe rather than throw.
  ...fetchCalls,
  subscribe: jest.fn(() => () => {}),
  getSyncStatus: jest.fn(() => null),
  getStats: jest.fn(() => undefined),
  getSetting: jest.fn(() => undefined),
  setSetting: jest.fn(),
  setSettings: jest.fn(),
  deleteSetting: jest.fn(),
};

/**
 * The delegate namespaces the barrel binds to the engine, closed like it. Each
 * function answers undefined, and a test that needs one to answer overrides
 * the whole namespace by name.
 */
export const elevation = {
  startElevationBackfill: jest.fn(),
  pauseElevationBackfill: jest.fn(),
  resumeElevationBackfill: jest.fn(),
  getElevationBackfillRemaining: jest.fn(),
};

export const streamBackfill = {
  startStreamBackfill: jest.fn(),
  consentStreamBackfill: jest.fn(),
  stopStreamBackfill: jest.fn(),
};

export const settings = {
  getRecordScreenData: jest.fn(() => undefined),
};

export const connectivity = {
  setNetworkOnline: jest.fn(),
  setInteracting: jest.fn(),
};

export const maps = {
  getMapScreenData: jest.fn(),
  getAllMapSignatures: jest.fn(),
  queryViewport: jest.fn(),
};

export const launch = {
  launchData: jest.fn(),
};

export const routesStatus = {
  getRoutesStatusData: jest.fn(),
};

export const cutover = {
  isCutoverHeld: jest.fn(),
  startDetectorCutover: jest.fn(),
  getCutoverDiff: jest.fn(),
  getChangeCardSupport: jest.fn(),
};

export const heatmap = {
  enableHeatmapTiles: jest.fn(),
  disableHeatmapTiles: jest.fn(),
  setHeatmapPriorityView: jest.fn(),
  clearHeatmapPriorityView: jest.fn(),
  cancelHeatmapWork: jest.fn(),
  startHeatmapCacheSize: jest.fn(),
  readHeatmapCacheSizeRun: jest.fn(),
  takeHeatmapCacheSize: jest.fn(),
  cancelHeatmapCacheSize: jest.fn(),
  clearHeatmapTiles: jest.fn(),
  getHeatmapTileProgress: jest.fn(),
  pollTileGeneration: jest.fn(),
};

export const recordings = {
  addRecording: jest.fn(),
  listRecordings: jest.fn(),
  getRecording: jest.fn(),
  listVisibleRecordings: jest.fn(),
  getVisibleRecording: jest.fn(),
  unuploadedVisibleRecordingCount: jest.fn(),
  attachRecordingEngineActivity: jest.fn(),
  holdRecordingsOfOtherAthletes: jest.fn(),
  transitionRecording: jest.fn(),
  stampOwnerlessRecordings: jest.fn(),
  clearRecordingPermissionBlocked: jest.fn(),
  wakeUploadSchedule: jest.fn(),
  uploadRecording: jest.fn(),
  deleteOwnRecording: jest.fn(),
  clearRecordings: jest.fn(),
};

export const strength = {
  getExerciseSets: jest.fn(),
  getExerciseDetailData: jest.fn(),
  isFitProcessed: jest.fn(),
  fetchAndParseExerciseSets: jest.fn(),
  getMuscleGroups: jest.fn(),
  getUnprocessedStrengthIds: jest.fn(),
  batchFetchOwedFitFiles: jest.fn(),
  getStrengthScreenData: jest.fn(),
  getMuscleDetail: jest.fn(),
  hasStrengthData: jest.fn(),
  getActivitiesForExercise: jest.fn(),
  bulkInsertExerciseSets: jest.fn(),
};

export const routes = {
  getGroups: jest.fn(),
  getFilteredGroupSummaries: jest.fn(),
  setRouteName: jest.fn(),
  getRepresentativeRoute: jest.fn(),
  liveRouteOverlaps: jest.fn(),
  getRoutePerformances: jest.fn(),
  excludeActivityFromRoute: jest.fn(),
  includeActivityInRoute: jest.fn(),
  getRoutesScreenData: jest.fn(),
  setRouteRepresentative: jest.fn(),
  resetRouteRepresentative: jest.fn(),
  getRouteDetailData: jest.fn(),
  getRouteDetailPerformance: jest.fn(),
  loadRouteDetailPerformance: jest.fn(),
};

export const detection = {
  startSectionDetection: jest.fn(),
  cancelSectionDetection: jest.fn(),
  pollSectionDetection: jest.fn(),
  pollSectionDetectionRun: jest.fn(),
  sectionDetectionAwaiting: jest.fn(),
  getSectionDetectionProgress: jest.fn(),
  setSectionConfig: jest.fn(),
  getSectionConfig: jest.fn(),
  setMatchStrictness: jest.fn(),
  getMatchStrictness: jest.fn(),
  forceRedetectSections: jest.fn(),
};

/** The section delegates a screen test feeds its own answer through `withOverrides`. */
export const sections = {
  getRetiredMapData: jest.fn(),
};

export const preview = {
  getPreviewCentres: jest.fn(),
  getPreviewCurrentSections: jest.fn(),
  startPreviewDetect: jest.fn(),
  pollPreviewDetect: jest.fn(),
  getPreviewProgress: jest.fn(),
  takePreviewResult: jest.fn(),
  cancelPreviewDetect: jest.fn(),
};

export const routeGroupingPreview = {
  runRouteGroupingPreview: jest.fn(),
  cancelRouteGroupingPreview: jest.fn(),
};

/** The preview screens' client, closed like the namespaces it is made of. */
export const previewClient = createPreviewClientStub();

/**
 * The namespaces above, each function answering through the same-named method
 * of the object `source` returns at the call. A suite that builds one fake
 * engine and hands it out through `getEngine` keeps that fake, and the code
 * under test still reaches it through the namespace it calls. A method the
 * fake lacks throws, as calling it on the fake itself would.
 */
export function namespacesOver(source: () => unknown): Record<string, Record<string, unknown>> {
  const over = (closed: Record<string, unknown>) =>
    Object.fromEntries(
      Object.keys(closed).map((name) => [
        name,
        jest.fn((...args: unknown[]) => {
          const fake = source() as Record<string, unknown> | null | undefined;
          const method = fake?.[name];
          if (typeof method !== 'function') throw new TypeError(`${name} is not a function`);
          return method.apply(fake, args);
        }),
      ])
    );
  return {
    maps: over(maps),
    launch: over(launch),
    routesStatus: over(routesStatus),
    cutover: over(cutover),
    heatmap: over(heatmap),
    recordings: over(recordings),
    strength: over(strength),
    routes: over(routes),
    detection: over(detection),
    preview: over(preview),
    routeGroupingPreview: over(routeGroupingPreview),
    previewClient: over(previewClient),
  };
}

/**
 * The basemap tile store, closed. `setPath` is what launch hands it, and the
 * reads answer nothing so a caller falls through the way it does before the
 * path is set.
 */
export const basemap = {
  setPath: jest.fn(),
  setSourceTemplate: jest.fn(),
  tileListener: jest.fn(() => undefined),
  getTile: jest.fn(() => undefined),
  getOrFetchTile: jest.fn(() => undefined),
  getCacheSize: jest.fn(() => Promise.resolve(0)),
  getSourceSize: jest.fn(() => Promise.resolve(0)),
  setBudget: jest.fn(() => Promise.resolve(0)),
  clearTiles: jest.fn(() => Promise.resolve(0)),
  clearUnpinnedTiles: jest.fn(() => Promise.resolve(0)),
  resetTileCounts: jest.fn(),
  tileCounts: jest.fn(() => []),
  flush: jest.fn(),
};

export const basemapStore = jest.fn(() => basemap);

/**
 * The stub with `overrides` applied. An override replaces the export it names
 * rather than merging into it, so a test that lists the engine methods it
 * expects to be touched still sees only its own.
 */
export function withOverrides(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CallKind,
    UploadOutcome,
    SyncState,
    SyncErrorReason,
    SyncStep,
    TrackStep,
    DownloadPriority,
    BulkExportFormat,
    RecordScope,
    GroupSort,
    EngineSportFamily,
    IntervalKind,
    MapDistanceBand,
    EfficiencyDirection,
    FfiOffScale,
    SectionSort,
    LoadMetric,
    DayLoadStatus,
    MaxHrSource,
    PoolSwimState,
    PoolUnit,
    CadenceUnit,
    BestEffortKind,
    StartOutcome,
    InitOutcome,
    RangeCoverage,
    GarminKeyStatus,
    RetiredPairLink,
    FfiReferenceSource,
    FfiPlannedCategory,
    FfiPlanTarget,
    FfiPlanLineKind,
    FfiTargetMetric,
    FfiAbsoluteUnits,
    FfiCatalogueEmptyReason_Tags,
    FfiDetectionHold_Tags,
    FfiMapEmptyReason_Tags,
    isRetryableInit,
    hasOpened,
    isRetryableStart,
    hasStarted,
    startOutcome,
    isRouteNameTakenError,
    decodeCoords,
    decodeCoordsFlat,
    createPreviewClientStub,
    takeFetchAndStoreResult,
    engine,
    elevation,
    streamBackfill,
    settings,
    connectivity,
    maps,
    launch,
    routesStatus,
    cutover,
    heatmap,
    recordings,
    strength,
    routes,
    detection,
    sections,
    preview,
    routeGroupingPreview,
    previewClient,
    basemapStore,
    ...overrides,
  };
}
