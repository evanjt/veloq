/**
 * Scenario: a rider pans the global map, closes the app, and opens it again.
 *
 * Expected behaviour: the camera they left is what the map opens on. It was
 * being written on every settle and never read back (`U27`), so every launch
 * started at the world view.
 *
 * The module caches the camera at module scope, so each test needs its own
 * module registry and `require` is the only way to reach one.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const STORAGE_KEY = '@map_camera_state';
const BERN = { center: [7.44, 46.95] as [number, number], zoom: 11 };

function freshModule(stored: string | null) {
  jest.resetModules();
  const settings = new Map<string, string>();
  if (stored !== null) settings.set(STORAGE_KEY, stored);
  const engine = {
    getSetting: jest.fn((key: string) => settings.get(key)),
    setSetting: jest.fn((key: string, value: string) => settings.set(key, value)),
    deleteSetting: jest.fn((key: string) => settings.delete(key)),
  };
  const { getEngine } = require('@/shared/native/engine');
  (getEngine as jest.Mock).mockReturnValue(engine);
  const mod = require('@/features/maps/lib/storage/mapCameraState');
  return { ...mod, engine, settings };
}

describe('mapCameraState', () => {
  it('reads the stored camera back synchronously', () => {
    const mod = freshModule(JSON.stringify(BERN));

    expect(mod.getMapCameraState()).toEqual(BERN);
  });

  it('reads null when nothing was ever saved', () => {
    const mod = freshModule(null);

    expect(mod.getMapCameraState()).toBeNull();
  });

  it('reads null from a value that is not a camera', () => {
    const mod = freshModule('not json');

    expect(mod.getMapCameraState()).toBeNull();
  });

  it('asks the engine once and caches the answer', () => {
    const mod = freshModule(JSON.stringify(BERN));

    mod.getMapCameraState();
    const afterFirst = mod.engine.getSetting.mock.calls.length;
    mod.getMapCameraState();

    expect(mod.engine.getSetting.mock.calls.length).toBe(afterFirst);
  });

  it('returns what the last settle saved', () => {
    const mod = freshModule(null);

    mod.saveMapCameraState([8.5, 47.4], 13);

    expect(mod.getMapCameraState()).toEqual({ center: [8.5, 47.4], zoom: 13 });
  });

  it('re-reads from storage after a restore drops the cache', async () => {
    const mod = freshModule(JSON.stringify(BERN));
    expect(mod.getMapCameraState()).toEqual(BERN);

    mod.settings.set(STORAGE_KEY, JSON.stringify({ center: [0, 51.5], zoom: 9 }));
    await mod.reloadMapCameraState();

    expect(mod.getMapCameraState()).toEqual({ center: [0, 51.5], zoom: 9 });
  });

  it('reads null when the engine is not up yet', () => {
    jest.resetModules();
    const { getEngine } = require('@/shared/native/engine');
    (getEngine as jest.Mock).mockReturnValue(null);
    const mod = require('@/features/maps/lib/storage/mapCameraState');

    expect(mod.getMapCameraState()).toBeNull();
  });
});
