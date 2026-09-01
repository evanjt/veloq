/**
 * Stand-in for the Rust engine binding. The real module registers a TurboModule
 * at import time, which throws outside a native runtime, so any component that
 * transitively imports it cannot be rendered without this.
 *
 * Only the value exports need a body. Types are erased before Jest sees them.
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

export const engine = {
  create: jest.fn(),
};
