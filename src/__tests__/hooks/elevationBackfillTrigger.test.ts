/**
 * Scenario: the elevation backfill has to keep trying on every launch until
 * Rust reports nothing left to ask, then stop for the rest of the app version.
 * A refusal (no credential yet, a run in flight), a partial pass or a thrown
 * FFI error must cost one launch, never the whole version.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { getRouteEngine } from '@/shared/native/routeEngine';
import { startElevationBackfillAfterUpdate } from '@/features/routes/lib/elevationBackfillTrigger';

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

/**
 * Scenario: a pass ends partial because the connection was down, and the app
 * stays open for hours afterwards.
 * Expected behaviour: coming back to the foreground tries again, spaced further
 * apart each time so a dead connection is not asked once a minute forever. The
 * launch attempt arms the first wait, so a foreground straight after launch
 * does not double up on it.
 */
describe('resumeElevationBackfill', () => {
  let start: jest.Mock;
  let remaining: jest.Mock;
  let now: number;
  let trigger: typeof import('@/features/routes/lib/elevationBackfillTrigger');

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    await AsyncStorage.clear();
    mockVersion.current = '0.3.1';
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    start = jest.fn().mockReturnValue(true);
    remaining = jest.fn().mockReturnValue(5);
    // Resetting the registry hands the trigger a fresh copy of the engine
    // mock, so the outer handle is not the one it will call.
    const fresh = require('@/shared/native/routeEngine').getRouteEngine as jest.Mock;
    fresh.mockReturnValue(engineWith(start, remaining));
    trigger = require('@/features/routes/lib/elevationBackfillTrigger');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Foreground until it accepts a run, and report how long that took. */
  async function waitForNextRun(): Promise<number> {
    const before = start.mock.calls.length;
    const startedAt = now;
    for (let step = 0; step < 200; step += 1) {
      await trigger.resumeElevationBackfill();
      if (start.mock.calls.length > before) return now - startedAt;
      now += 60_000;
    }
    throw new Error('the backfill was never attempted again');
  }

  it('does not re-attempt straight after the launch pass', async () => {
    await trigger.startElevationBackfillAfterUpdate();
    expect(start).toHaveBeenCalledTimes(1);

    await trigger.resumeElevationBackfill();

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('attempts again once the wait has passed', async () => {
    await trigger.startElevationBackfillAfterUpdate();

    expect(await waitForNextRun()).toBeGreaterThan(0);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('waits longer after each attempt that leaves work owing', async () => {
    await trigger.startElevationBackfillAfterUpdate();

    const waits = [await waitForNextRun(), await waitForNextRun(), await waitForNextRun()];

    expect(waits[1]).toBeGreaterThan(waits[0]);
    expect(waits[2]).toBeGreaterThan(waits[1]);
  });

  it('caps the wait rather than growing it without bound', async () => {
    await trigger.startElevationBackfillAfterUpdate();

    let last = 0;
    for (let i = 0; i < 12; i += 1) last = await waitForNextRun();

    expect(last).toBeLessThanOrEqual(30 * 60_000);
  });

  it('stops asking once the library has been fully asked', async () => {
    remaining.mockReturnValue(0);
    await trigger.startElevationBackfillAfterUpdate();
    expect(start).not.toHaveBeenCalled();

    now += 60 * 60_000;
    await trigger.resumeElevationBackfill();

    expect(start).not.toHaveBeenCalled();
  });
});
