import { requireOptionalNativeModule } from 'expo-modules-core';

/** The platform's own account of the app's storage, in bytes: user data and cache, each apart from the other. */
export interface PlatformAppStorageStats {
  dataBytes: number;
  cacheBytes: number;
}

interface AppStorageStatsModule {
  getAppStorageStats(): Promise<PlatformAppStorageStats>;
}

/**
 * Android's figure for this app, the one its app info screen shows: user data
 * and cache, counted by allocated blocks. Resolves `null` when the build has no
 * such module; rejects when the platform refuses the query.
 */
export async function getPlatformAppStorageStats(): Promise<PlatformAppStorageStats | null> {
  const mod = requireOptionalNativeModule<AppStorageStatsModule>('VeloqBackupExclusion');
  return mod?.getAppStorageStats ? mod.getAppStorageStats() : null;
}
