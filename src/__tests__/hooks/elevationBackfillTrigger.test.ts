/**
 * Scenario: the elevation backfill has to keep trying on every launch until
 * Rust reports nothing left to ask, then stop for the rest of the app version.
 * A refusal (no credential yet, a run in flight), a partial pass or a thrown
 * FFI error must cost one launch, never the whole version.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const mockVersion = { current: '0.3.1' };

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      get version() {
        return mockVersion.current;
      },
    },
  },
}));

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
}));

import { getRouteEngine } from '@/shared/native/routeEngine';
import { startElevationBackfillAfterUpdate } from '@/features/routes/lib/elevationBackfillTrigger';

const mockGetRouteEngine = getRouteEngine as jest.MockedFunction<typeof getRouteEngine>;

const VERSION_KEY = 'veloq-elevation-backfill-version';

function engineWith(start: jest.Mock, remaining: jest.Mock) {
  return {
    startElevationBackfill: start,
    getElevationBackfillRemaining: remaining,
  } as unknown as ReturnType<typeof getRouteEngine>;
}

describe('startElevationBackfillAfterUpdate', () => {
  let start: jest.Mock;
  let remaining: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockVersion.current = '0.3.1';
    start = jest.fn().mockReturnValue(true);
    remaining = jest.fn().mockReturnValue(5);
    mockGetRouteEngine.mockReturnValue(engineWith(start, remaining));
  });

  it('starts a run while tracks still lack elevation, without stamping', async () => {
    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(true);

    expect(start).toHaveBeenCalledTimes(1);
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();
  });

  it('retries on the next launch after a refused start', async () => {
    start.mockReturnValue(false);

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(false);
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();

    start.mockReturnValue(true);
    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(true);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('stamps the version once nothing is left to ask, then stops calling', async () => {
    remaining.mockReturnValue(0);

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(false);

    expect(start).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBe('0.3.1');

    remaining.mockClear();
    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(false);
    expect(remaining).not.toHaveBeenCalled();
  });

  it('attempts again after the version changes even when previously stamped', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '0.3.0');

    await startElevationBackfillAfterUpdate();

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('starts one run when the engine init effect fires twice at once', async () => {
    const [first, second] = await Promise.all([
      startElevationBackfillAfterUpdate(),
      startElevationBackfillAfterUpdate(),
    ]);

    expect(start).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('leaves the version unstamped when the engine is unavailable', async () => {
    mockGetRouteEngine.mockReturnValue(null);

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(false);

    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();
  });

  it('does not stamp when the remaining count is unreadable', async () => {
    remaining.mockReturnValue(null);

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(true);

    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();
  });

  it('survives a throwing engine and retries on the next launch', async () => {
    start.mockImplementation(() => {
      throw new Error('engine gone');
    });

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(false);
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();

    start.mockReset().mockReturnValue(true);
    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(true);
  });
});
