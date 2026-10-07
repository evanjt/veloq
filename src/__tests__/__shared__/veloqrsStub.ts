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

/** `FfiGroupSort` as generated, held to the source by the same test. */
export enum GroupSort {
  Nearby = 0,
  Activities = 1,
  Distance = 2,
  Name = 3,
}

/** `FfiFeedGroup` as generated, the feed's sport chips as the engine names them. */
export enum FeedSportGroup {
  Cycling = 0,
  Running = 1,
  Swimming = 2,
  Other = 3,
}

/** `FfiFeedSeen` as generated: three tagged variants built with `.new`. */
export const FfiFeedSeen = {
  Opened: { new: () => ({ tag: 'Opened' }) },
  Closed: { new: () => ({ tag: 'Closed' }) },
  Dismissed: { new: (inner: { activityIds: string[] }) => ({ tag: 'Dismissed', inner }) },
};

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

/** `RangeCoverage` as generated, held to the source by the same test. */
export enum RangeCoverage {
  Empty = 1,
  NotFetched = 2,
  Loaded = 3,
}

/** `FfiReferenceSource` as generated, held to the source by the same test. */
export enum FfiReferenceSource {
  Record,
  AthleteSet,
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
export const startFetchAndStore = jest.fn(() => 0);
export const takeFetchAndStoreResult = jest.fn(() => undefined);
export const cancelFetchAndStore = jest.fn(() => true);
export const getFetchRunProgress = jest.fn(() => ({ active: false, completed: 0, total: 0 }));
/** The fetch-and-store calls as the engine client carries them, for a test that overrides `engine`. */
export const fetchCalls = {
  startFetchAndStore,
  takeFetchAndStoreResult,
  cancelFetchAndStore,
  getFetchRunProgress,
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
  getSetting: jest.fn(() => undefined),
  setSetting: jest.fn(),
  setSettings: jest.fn(),
  deleteSetting: jest.fn(),
};

/**
 * The basemap tile store, closed. `setPath` is what launch hands it, and the
 * reads answer nothing so a caller falls through the way it does before the
 * path is set.
 */
export const basemap = {
  setPath: jest.fn(),
  setSourceTemplate: jest.fn(),
  getTile: jest.fn(() => undefined),
  getOrFetchTile: jest.fn(() => undefined),
  getCacheSize: jest.fn(() => Promise.resolve(0)),
  getSourceSize: jest.fn(() => Promise.resolve(0)),
  setBudget: jest.fn(() => Promise.resolve(0)),
  clearTiles: jest.fn(() => 0),
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
    DownloadPriority,
    BulkExportFormat,
    GroupSort,
    FeedSportGroup,
    FfiFeedSeen,
    MapDistanceBand,
    EfficiencyDirection,
    SectionSort,
    LoadMetric,
    DayLoadStatus,
    StartOutcome,
    InitOutcome,
    RangeCoverage,
    FfiReferenceSource,
    isRetryableInit,
    hasOpened,
    isRetryableStart,
    hasStarted,
    startOutcome,
    decodeCoords,
    createPreviewClientStub,
    startFetchAndStore,
    takeFetchAndStoreResult,
    engine,
    basemapStore,
    ...overrides,
  };
}
