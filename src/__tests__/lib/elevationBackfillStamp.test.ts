/**
 * Scenario: the stamp says this app version has finished the backfill, then
 * the database it described is replaced by a restore.
 *
 * Expected behaviour: clearing the stamp is enough to make the next attempt
 * ask the engine again, on the same app version and without a relaunch
 * (`SB13`).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { startElevationBackfillAfterUpdate } from '@/features/routes/lib/elevationBackfillTrigger';
import { clearDatabaseStamps } from '@/shared/storage/databaseStamps';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.4.0' } },
}));

const VERSION_KEY = 'veloq-elevation-backfill-version';

const engine = {
  getElevationBackfillRemaining: jest.fn(() => 12),
  startElevationBackfill: jest.fn(() => true),
};

describe('elevation backfill stamp', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (getEngine as jest.Mock).mockReturnValue(engine);
  });

  it('declines while the stamp names the running version', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '0.4.0');

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(false);
    expect(engine.startElevationBackfill).not.toHaveBeenCalled();
  });

  it('asks again once the stamp is cleared, on the same version', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '0.4.0');
    await clearDatabaseStamps();

    await expect(startElevationBackfillAfterUpdate()).resolves.toBe(true);
    expect(engine.startElevationBackfill).toHaveBeenCalledTimes(1);
  });

  it('leaves nothing behind to read', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '0.4.0');
    await clearDatabaseStamps();

    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();
  });

  it('is safe to clear when no stamp was written', async () => {
    await expect(clearDatabaseStamps()).resolves.toBeUndefined();
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();
  });
});
