/**
 * Scenario: the elevation backfill has to keep trying on every launch until
 * Rust reports nothing left to ask, then stop for the rest of the app version.
 * A refusal (no credential yet, a run in flight), a partial pass or a thrown
 * FFI error must cost one launch, never the whole version.
 *
 * Expected behaviour: the trigger answers with the reason rather than a bare
 * boolean, and stamps only on the one refusal that says the job is done.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StartOutcome } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
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

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const VERSION_KEY = 'veloq-elevation-backfill-version';

function engineWith(start: jest.Mock, remaining: jest.Mock) {
  return {
    startElevationBackfill: start,
    getElevationBackfillRemaining: remaining,
  } as unknown as ReturnType<typeof getEngine>;
}

describe('startElevationBackfillAfterUpdate', () => {
  let start: jest.Mock;
  let remaining: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockVersion.current = '0.3.1';
    start = jest.fn().mockReturnValue(StartOutcome.Started);
    remaining = jest.fn().mockReturnValue(5);
    mockGetEngine.mockReturnValue(engineWith(start, remaining));
  });

  it('starts a run while tracks still lack elevation, without stamping', async () => {
    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(StartOutcome.Started);

    expect(start).toHaveBeenCalledTimes(1);
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();
  });

  it('retries on the next launch after a refused start', async () => {
    start.mockReturnValue(StartOutcome.Busy);

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(StartOutcome.Busy);
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();

    start.mockReturnValue(StartOutcome.Started);
    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(StartOutcome.Started);
    expect(start).toHaveBeenCalledTimes(2);
  });

  /**
   * Scenario: the count read at launch says work is owed, the pass drains the
   * last of it, and the next launch's start finds nothing left.
   * Expected behaviour: that is the job finishing. It used to arrive as the
   * same `false` as being offline, so the version was never stamped and every
   * later launch paid for two FFI calls to learn the same thing.
   */
  it('stamps the version when the start itself says nothing is owed', async () => {
    start.mockReturnValue(StartOutcome.NotOwed);

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(StartOutcome.NotOwed);
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBe('0.3.1');

    start.mockClear();
    remaining.mockClear();
    await startElevationBackfillAfterUpdate();
    expect(start).not.toHaveBeenCalled();
    expect(remaining).not.toHaveBeenCalled();
  });

  it('leaves the version alone for a refusal that is not the job finishing', async () => {
    for (const outcome of [
      StartOutcome.Busy,
      StartOutcome.Held,
      StartOutcome.NotReady,
      StartOutcome.NotConfigured,
      StartOutcome.Offline,
      StartOutcome.Failed,
    ]) {
      start.mockReturnValue(outcome);
      await expect(startElevationBackfillAfterUpdate()).resolves.toBe(outcome);
      await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();
    }
  });

  it('stamps the version once nothing is left to ask, then stops calling', async () => {
    remaining.mockReturnValue(0);

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(StartOutcome.NotOwed);

    expect(start).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBe('0.3.1');

    remaining.mockClear();
    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(StartOutcome.NotOwed);
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
    mockGetEngine.mockReturnValue(null);

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(StartOutcome.NotReady);

    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();
  });

  it('does not stamp when the remaining count is unreadable', async () => {
    remaining.mockReturnValue(null);

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(StartOutcome.Started);

    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();
  });

  it('survives a throwing engine and retries on the next launch', async () => {
    start.mockImplementation(() => {
      throw new Error('engine gone');
    });

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(StartOutcome.Failed);
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();

    start.mockReset().mockReturnValue(StartOutcome.Started);
    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(StartOutcome.Started);
  });
});
