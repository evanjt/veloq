import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { debug } from '@/shared/debug/debug';

const log = debug.create('AppGroup');

interface VeloqAppGroupModule {
  containerPath(): string | null;
}

/**
 * The shared App Group container, as a plain path with a trailing slash.
 *
 * Null on Android, which has no such thing, and null on iOS when the
 * entitlement did not take. A caller treats null as "keep using Documents"
 * rather than as an error: the container is where an extension can reach the
 * database, not where the database has to be for the app itself to work.
 */
export function appGroupPath(): string | null {
  if (Platform.OS !== 'ios') return null;
  const mod = requireOptionalNativeModule<VeloqAppGroupModule>('VeloqAppGroup');
  if (!mod) return null;
  try {
    return mod.containerPath() ?? null;
  } catch (e) {
    log.warn('could not read the App Group container:', e);
    return null;
  }
}
