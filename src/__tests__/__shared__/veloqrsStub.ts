/**
 * Stand-in for the Rust engine binding. The real module registers a TurboModule
 * at import time, which throws outside a native runtime, so any component that
 * transitively imports it cannot be rendered without this.
 *
 * Only the value exports need a body. Types are erased before Jest sees them.
 */

export const decodeCoords = jest.fn(() => [] as Array<{ lat: number; lng: number }>);
export const startFetchAndStore = jest.fn();
export const takeFetchAndStoreResult = jest.fn(() => null);
export const getDownloadProgress = jest.fn(() => null);

export const routeEngine = {
  create: jest.fn(),
};
