/**
 * Whether the device is short of space, read when a write has already failed
 * so the athlete is told the cause and where to free space rather than only
 * that the write did not land.
 */

import * as FileSystem from 'expo-file-system/legacy';

/**
 * Below this much free space a failed save is put down to the device being
 * full. A saved ride needs a few megabytes across its file and the library,
 * and the platform starts refusing writes before free space reaches zero.
 */
export const LOW_FREE_SPACE_BYTES = 100 * 1024 * 1024;

/** True when free space is below the threshold; false when it cannot be read. */
export async function isDeviceLowOnSpace(): Promise<boolean> {
  try {
    const free = await FileSystem.getFreeDiskStorageAsync();
    return Number.isFinite(free) && free < LOW_FREE_SPACE_BYTES;
  } catch {
    return false;
  }
}
