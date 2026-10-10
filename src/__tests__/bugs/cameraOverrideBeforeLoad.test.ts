/**
 * Scenario: the app cold-launches straight into an activity, so the screen
 * that used to load the saved 3D cameras never mounts, and the athlete saves
 * or clears a camera there.
 *
 * Expected behaviour: the store loads what is saved before it changes
 * anything, so the write keeps every other activity's camera rather than
 * persisting only the one in memory over all of them.
 */

import type { TerrainCamera } from '@/features/maps/lib/cameraAngle';

const KEY = '@terrain_camera_overrides';
const mockSettings = new Map<string, string>();

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockSettings.set(key, value);
  }),
  removeSetting: jest.fn(async (key: string) => {
    mockSettings.delete(key);
  }),
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  deleteTerrainPreviewsForActivity: jest.fn(async () => {}),
}));

type Store = typeof import('@/features/maps/lib/storage/terrainCameraOverrides');

function camera(zoom: number): TerrainCamera {
  return { center: [8.5, 47.3], zoom, bearing: 30, pitch: 60 };
}

/** The store as a fresh launch sees it: nothing loaded yet. */
function freshStore(): Store {
  let store!: Store;
  jest.isolateModules(() => {
    store = require('@/features/maps/lib/storage/terrainCameraOverrides');
  });
  return store;
}

function stored(): Record<string, TerrainCamera> {
  return JSON.parse(mockSettings.get(KEY) ?? '{}');
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  mockSettings.clear();
  mockSettings.set(KEY, JSON.stringify({ a1: camera(11), a2: camera(12) }));
});

describe('a camera written before the store was loaded', () => {
  it('saving one keeps every camera already stored', async () => {
    const store = freshStore();

    await store.setCameraOverride('a3', camera(13));
    await settle();

    expect(Object.keys(stored())).toEqual(['a1', 'a2', 'a3']);
    expect(store.getCameraOverride('a1')).toEqual(camera(11));
    expect(store.getCameraOverride('a3')).toEqual(camera(13));
  });

  it('clearing one keeps the others', async () => {
    const store = freshStore();

    await store.deleteCameraOverride('a1');
    await settle();

    expect(Object.keys(stored())).toEqual(['a2']);
    expect(store.getCameraOverride('a1')).toBeUndefined();
  });

  it('saving over a stored camera replaces it and moves it to the newest', async () => {
    const store = freshStore();

    await store.setCameraOverride('a1', camera(15));
    await settle();

    expect(stored()).toEqual({ a2: camera(12), a1: camera(15) });
    expect(Object.keys(stored())).toEqual(['a2', 'a1']);
  });

  it('a load started by a reader and a write racing it agree', async () => {
    const store = freshStore();

    const unsubscribe = store.subscribeCameraOverrides(() => {});
    await store.setCameraOverride('a3', camera(13));
    await settle();
    unsubscribe();

    expect(Object.keys(stored())).toEqual(['a1', 'a2', 'a3']);
    expect(store.getCameraOverridesSnapshot().get('a2')).toEqual(camera(12));
  });

  it('a reader alone loads the saved cameras', async () => {
    const store = freshStore();

    const unsubscribe = store.subscribeCameraOverrides(() => {});
    await settle();
    unsubscribe();

    expect(store.getCameraOverride('a1')).toEqual(camera(11));
    expect(store.getCameraOverridesSnapshot().size).toBe(2);
  });

  it('a wipe during the load is not undone by it', async () => {
    const store = freshStore();

    const loading = store.initCameraOverrides();
    await store.forgetCameraOverrides();
    await loading;
    await store.setCameraOverride('a3', camera(13));
    await settle();

    expect(Object.keys(stored())).toEqual(['a3']);
    expect(store.getCameraOverride('a1')).toBeUndefined();
  });

  it('with nothing stored, the first save is the only camera', async () => {
    mockSettings.clear();
    const store = freshStore();

    await store.setCameraOverride('a3', camera(13));
    await settle();

    expect(Object.keys(stored())).toEqual(['a3']);
  });
});
