import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { debug } from '@/shared/debug/debug';

const log = debug.create('AndroidAutoBackup');

/**
 * What Android's Auto Backup last did with the app, as the backup agent
 * recorded it: times in epoch milliseconds, sizes in bytes, each `null` until
 * the platform has called the agent for it. An overrun is the last payload
 * Android dropped whole for being over its quota.
 */
export interface AndroidAutoBackupStatus {
  backedUpAt: number | null;
  backedUpBytes: number | null;
  quotaExceededAt: number | null;
  quotaExceededBytes: number | null;
  quotaBytes: number | null;
  restoredAt: number | null;
}

interface AutoBackupStatusModule {
  getAutoBackupStatus(): AndroidAutoBackupStatus;
}

/**
 * The backup agent's record, read from its preferences file. `null` off
 * Android, in a build without the module, or when the read fails, since then
 * nothing is known about what Android did.
 */
export function getAndroidAutoBackupStatus(): AndroidAutoBackupStatus | null {
  if (Platform.OS !== 'android') return null;
  const mod = requireOptionalNativeModule<AutoBackupStatusModule>('VeloqBackupExclusion');
  if (!mod?.getAutoBackupStatus) return null;
  try {
    return mod.getAutoBackupStatus();
  } catch (e) {
    log.warn('could not read the Auto Backup record:', e);
    return null;
  }
}
