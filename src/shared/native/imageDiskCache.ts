import { requireOptionalNativeModule } from 'expo-modules-core';

import { debug } from '@/shared/debug/debug';

const log = debug.create('ImageDiskCache');

interface ImageDiskCacheModule {
  clearImageDiskCache?(): void;
}

/** Android's lives on the memory module, iOS's on the backup exclusion module. */
const MODULES = ['VeloqMemory', 'VeloqBackupExclusion'];

/**
 * Empty the image loader's disk cache: Fresco's on Android, the shared URL cache
 * on iOS. The core `Image` fetches the athlete's profile photo through it, and
 * the cache keeps the response after the athlete's data is wiped. Never throws,
 * so the rest of the wipe goes on.
 */
export function clearImageDiskCache(): void {
  for (const name of MODULES) {
    try {
      requireOptionalNativeModule<ImageDiskCacheModule>(name)?.clearImageDiskCache?.();
    } catch (e) {
      log.warn(`${name} could not clear the image disk cache:`, e);
    }
  }
}
