/**
 * The device-local stamps that describe the database rather than the device.
 *
 * A `.veloqdb` restore replaces the database under them, so every one is stale
 * the moment it lands: it records what was done to a library that is no longer
 * there. They live in one list, cleared in one place, and each entry is its
 * owner's own constant so a rename cannot quietly drop a member.
 *
 * A stamp that describes the device, the install or the account does not
 * belong here. `veloq-push-token-refreshed-at` is the example: it throttles
 * this device's re-registration and survives a restore correctly.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { TERRAIN_PREVIEW_VERSION_KEY } from '@/features/maps/lib/storage/terrainPreviewCache';

export const DATABASE_LOCAL_STAMPS = [TERRAIN_PREVIEW_VERSION_KEY] as const;

/**
 * Forget every stamp that described the replaced database.
 *
 * Best effort: a stamp that will not clear costs a launch, not the app, and
 * the restore itself has already succeeded by the time this runs.
 */
export async function clearDatabaseStamps(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([...DATABASE_LOCAL_STAMPS]);
  } catch {
    // Fall back to one at a time, so one unwritable key does not keep the rest.
    for (const key of DATABASE_LOCAL_STAMPS) {
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        // Nothing left to try for this one.
      }
    }
  }
}
