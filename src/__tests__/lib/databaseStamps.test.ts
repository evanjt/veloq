/**
 * Scenario: a `.veloqdb` restore replaces the database under stamps that
 * describe it. Clearing one and leaving the other two means a restored
 * library with no sections never gets its one-shot redetect and its
 * terrain previews stay keyed to route ids that no longer exist.
 *
 * Expected behaviour: one list, cleared in one place, built from each owner's
 * own key so a rename cannot quietly drop a member.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DATABASE_LOCAL_STAMPS, clearDatabaseStamps } from '@/shared/storage/databaseStamps';
import { ELEVATION_BACKFILL_STAMP_KEY } from '@/features/routes/lib/elevationBackfillTrigger';
import { SECTION_HEALTH_CHECK_KEY } from '@/features/routes/hooks/useSectionHealthCheck';
import { TERRAIN_PREVIEW_VERSION_KEY } from '@/features/maps/lib/storage/terrainPreviewCache';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

describe('database-local stamps', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('names every stamp that describes the database, by its owner constant', () => {
    expect(DATABASE_LOCAL_STAMPS).toEqual(
      expect.arrayContaining([
        ELEVATION_BACKFILL_STAMP_KEY,
        SECTION_HEALTH_CHECK_KEY,
        TERRAIN_PREVIEW_VERSION_KEY,
      ])
    );
  });

  it('clears all of them together', async () => {
    for (const key of DATABASE_LOCAL_STAMPS) {
      await AsyncStorage.setItem(key, 'done');
    }

    await clearDatabaseStamps();

    for (const key of DATABASE_LOCAL_STAMPS) {
      expect(await AsyncStorage.getItem(key)).toBeNull();
    }
  });

  it('leaves everything else alone', async () => {
    await AsyncStorage.setItem('veloq-theme-preference', 'dark');
    await AsyncStorage.setItem(ELEVATION_BACKFILL_STAMP_KEY, '0.4.0');

    await clearDatabaseStamps();

    expect(await AsyncStorage.getItem('veloq-theme-preference')).toBe('dark');
  });

  it('clears the rest when one of them will not go', async () => {
    for (const key of DATABASE_LOCAL_STAMPS) {
      await AsyncStorage.setItem(key, 'done');
    }
    const removeItem = jest
      .spyOn(AsyncStorage, 'multiRemove')
      .mockRejectedValueOnce(new Error('storage is full'));

    await expect(clearDatabaseStamps()).resolves.toBeUndefined();

    removeItem.mockRestore();
  });

  it('holds no duplicates, so the list reads as the record it is', () => {
    expect(new Set(DATABASE_LOCAL_STAMPS).size).toBe(DATABASE_LOCAL_STAMPS.length);
  });
});
