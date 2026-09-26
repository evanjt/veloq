import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { debug } from '@/shared/debug/debug';

const log = debug.create('BackupExclusion');

interface VeloqBackupExclusionModule {
  excludeFromBackup(path: string): boolean;
}

/**
 * Keep a path out of the device backup.
 *
 * iOS backs up all of Documents to iCloud unless a file says otherwise, and
 * the only way to say otherwise is the resource attribute this sets. Android
 * needs nothing: its backup rules are an allowlist, so an unnamed directory
 * is already outside them.
 *
 * Returns what the attribute reads back, `false` when it did not take, and
 * `null` when there was nothing to do.
 */
export function excludeFromBackup(path: string): boolean | null {
  if (Platform.OS !== 'ios') return null;
  const mod = requireOptionalNativeModule<VeloqBackupExclusionModule>('VeloqBackupExclusion');
  if (!mod) return null;
  try {
    return mod.excludeFromBackup(path);
  } catch (e) {
    log.warn('could not mark', path, 'excluded from backup:', e);
    return false;
  }
}
