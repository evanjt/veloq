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
}

/** `SyncState` as generated, held to the source by the same test. */
export enum SyncState {
  Idle = 1,
  Syncing = 2,
  Paused = 3,
  AuthExpired = 4,
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
}

export const isRetryableStart = (outcome: StartOutcome): boolean =>
  outcome === StartOutcome.Busy ||
  outcome === StartOutcome.Held ||
  outcome === StartOutcome.NotReady;

export const hasStarted = (outcome: StartOutcome): boolean => outcome === StartOutcome.Started;

export const decodeCoords = jest.fn(
  () => [] as { latitude: number; longitude: number; elevation?: number }[]
);

/** Fresh jest.fn PreviewClient, one per test, defaulting to an idle engine. */
export const createPreviewClientStub = () => ({
  subscribe: jest.fn(() => () => {}),
  getPreviewCentres: jest.fn(() => []),
  getPreviewCurrentSections: jest.fn(() => []),
  startPreviewDetect: jest.fn(() => false),
  pollPreviewDetect: jest.fn(() => 'idle'),
  getPreviewProgress: jest.fn(() => null),
  takePreviewResult: jest.fn(() => null),
  cancelPreviewDetect: jest.fn(),
  getSectionConfig: jest.fn(() => null),
  setSectionConfig: jest.fn(),
  forceRedetectSections: jest.fn(() => StartOutcome.Held),
});
export const startFetchAndStore = jest.fn();
export const takeFetchAndStoreResult = jest.fn(() => null);
export const getDownloadProgress = jest.fn(() => null);

/**
 * A closed engine, which is what a Jest run has: `ready` is false and every
 * read answers undefined, so a caller falls through to its own fallback the
 * way it does before `initWithPath`. An engine object that exists but answers
 * nothing throws instead, and reads as a wrong value rather than as absent.
 */
export const engine = {
  ready: false,
  getSetting: jest.fn(() => undefined),
  setSetting: jest.fn(),
  setSettings: jest.fn(() => 0),
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
    SyncState,
    SyncErrorReason,
    StartOutcome,
    isRetryableStart,
    hasStarted,
    decodeCoords,
    createPreviewClientStub,
    startFetchAndStore,
    takeFetchAndStoreResult,
    getDownloadProgress,
    engine,
    basemapStore,
    ...overrides,
  };
}
