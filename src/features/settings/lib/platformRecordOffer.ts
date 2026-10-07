/**
 * The restore route for the record zip the platform's device backup carries.
 *
 * A phone set up from a device backup gets the zip back in the documents
 * directory and no library. Nothing else reads that file, so the first
 * signed-in launch on an empty library applies it once, without asking, and
 * says what came back. A zip this library wrote itself is its own backup and
 * is never applied back, and one the engine's restore would refuse, another
 * athlete's or a newer format's, is left alone.
 */

import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import * as FileSystem from 'expo-file-system/legacy';

import { platformRecordUri } from '@/shared/storage/platformRecord';
import { debug } from '@/shared/debug/debug';
import { isPlatformRecordAnswered, markPlatformRecordAnswered } from './autobackup/autoBackup';
import { checkRecordBackup, restoreRecordBackup } from './backup';

const log = debug.create('PlatformRecord');

/** The zip to apply, or null. `activityCount` is read before the launch sync. */
export async function platformRecordToOffer(activityCount: number): Promise<string | null> {
  if (activityCount > 0 || isPlatformRecordAnswered()) return null;
  const uri = platformRecordUri();
  if (!uri) return null;
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || ('size' in info && !(info.size ?? 0))) return null;
  try {
    await checkRecordBackup(uri);
  } catch (error) {
    // Not answered: a refusal for want of a sign-in lifts on a later launch.
    log.log('Platform record not applied:', error instanceof Error ? error.message : error);
    return null;
  }
  return uri;
}

async function restorePlatformRecord(uri: string, t: TFunction): Promise<void> {
  try {
    await restoreRecordBackup(uri);
    Alert.alert(t('backup.restoreComplete'), t('backup.recordRestored'));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    log.warn('Platform record restore refused:', message);
    Alert.alert(
      t('common.error'),
      message.includes('another athlete')
        ? t('backup.backupDifferentAccount')
        : t('backup.importError')
    );
  }
}

/** Apply the platform zip when there is one to apply. The answer is final either way. */
export async function applyPlatformRecord(activityCount: number, t: TFunction): Promise<void> {
  const uri = await platformRecordToOffer(activityCount);
  if (!uri) return;
  markPlatformRecordAnswered();
  await restorePlatformRecord(uri, t);
}
