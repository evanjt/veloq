import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { debug } from '@/shared/debug/debug';

const log = debug.create('BackupExclusion');

interface VeloqBackupExclusionModule {
  excludeFromBackup(path: string): boolean;
  excludeExistingFromBackup(path: string): boolean | null;
}

function plainPath(path: string): string {
  return path.startsWith('file://') ? path.slice(7) : path;
}

/**
 * Keep a path out of the device backup.
 *
 * iOS backs up all of Documents to iCloud unless a file says otherwise, and
 * the only way to say otherwise is the resource attribute this sets. Android
 * needs nothing: its backup rules are an allowlist, so an unnamed directory
 * is already outside them.
 *
 * Takes a plain path or a `file://` URI. The native side reads its argument as
 * a path, so a URI handed through would name a relative directory of that
 * name instead.
 *
 * Returns what the attribute reads back, `false` when it did not take, and
 * `null` when there was nothing to do.
 */
export function excludeFromBackup(path: string): boolean | null {
  if (Platform.OS !== 'ios') return null;
  const mod = requireOptionalNativeModule<VeloqBackupExclusionModule>('VeloqBackupExclusion');
  if (!mod) return null;
  try {
    return mod.excludeFromBackup(plainPath(path));
  } catch (e) {
    log.warn('could not mark', path, 'excluded from backup:', e);
    return false;
  }
}

/**
 * Keep a file that already exists out of the device backup.
 *
 * `excludeFromBackup` makes a missing path as a directory, which is what a
 * store that has not written yet needs. A file can be deleted between being
 * listed and being marked, and making a directory in its place would leave one
 * under its name, so this marks only what is there.
 *
 * Returns what the attribute reads back, `false` when it did not take, and
 * `null` when there was nothing to do, the file having gone included.
 */
export function excludeExistingFromBackup(path: string): boolean | null {
  if (Platform.OS !== 'ios') return null;
  const mod = requireOptionalNativeModule<VeloqBackupExclusionModule>('VeloqBackupExclusion');
  if (!mod) return null;
  try {
    return mod.excludeExistingFromBackup(plainPath(path));
  } catch (e) {
    log.warn('could not mark', path, 'excluded from backup:', e);
    return false;
  }
}
