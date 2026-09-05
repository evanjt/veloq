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
 *     // eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('veloqrs', () =>
 *       require('../../__shared__/veloqrsStub').withOverrides({
 *         decodeCoords: () => [{ latitude: 1, longitude: 2 }],
 *       })
 *     );
 */

export const decodeCoords = jest.fn(
  () => [] as { latitude: number; longitude: number; elevation?: number }[]
);

/** Fresh jest.fn PreviewClient, one per test, defaulting to an idle engine. */
export const createPreviewClientStub = () => ({
  getPreviewCentres: jest.fn(() => []),
  startPreviewDetect: jest.fn(() => false),
  pollPreviewDetect: jest.fn(() => 'idle'),
  getPreviewProgress: jest.fn(() => null),
  takePreviewResult: jest.fn(() => null),
  cancelPreviewDetect: jest.fn(),
  getSectionConfig: jest.fn(() => null),
  setSectionConfig: jest.fn(),
  forceRedetectSections: jest.fn(() => false),
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
  create: jest.fn(),
  ready: false,
  getSetting: jest.fn(() => undefined),
  setSetting: jest.fn(),
  setSettings: jest.fn(() => 0),
  deleteSetting: jest.fn(),
};

/**
 * The stub with `overrides` applied. An override replaces the export it names
 * rather than merging into it, so a test that lists the engine methods it
 * expects to be touched still sees only its own.
 */
export function withOverrides(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decodeCoords,
    createPreviewClientStub,
    startFetchAndStore,
    takeFetchAndStoreResult,
    getDownloadProgress,
    engine,
    ...overrides,
  };
}
