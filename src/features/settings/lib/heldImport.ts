/**
 * An older backup picked while nobody is signed in, kept until someone is.
 *
 * A record is checked against the signed-in athlete, so the engine places none
 * before a sign-in. The file is read and converted when it is picked, which
 * refuses an unreadable one before anything is kept, and the result waits in
 * the documents directory, where no cache purge reaches it. The first
 * signed-in launch restores it through the record path and says what came
 * back. One is held at a time: a later pick replaces it.
 */

import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import * as FileSystem from 'expo-file-system/legacy';

import { restoreCopyUri } from '@/shared/storage/cacheFiles';
import { debug } from '@/shared/debug/debug';
import { markPlatformRecordAnswered } from './autobackup/autoBackup';
import {
  convertLegacyBackupToRecord,
  convertLegacyDatabaseFile,
  importWaitsForSignIn,
  restoreBackup,
  restoreRecordBackup,
} from './backup';

const log = debug.create('HeldImport');

/** The held `.veloq` file, kept as picked, since its conversion is cheap and repeatable. */
const HELD_LEGACY_JSON = 'veloq-held-import.veloq';
/** The record zip a held `.veloqdb` file converted to. */
const HELD_RECORD_ZIP = 'veloq-held-import.zip';

function heldUri(name: string): string | null {
  const docDir = FileSystem.documentDirectory;
  return docDir ? `${docDir}${name}` : null;
}

async function exists(uri: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists;
}

async function discardHeld(): Promise<void> {
  for (const name of [HELD_LEGACY_JSON, HELD_RECORD_ZIP]) {
    const uri = heldUri(name);
    if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

/** Whether a file of this name is held for sign-in rather than refused while signed out. */
export function isHeldWhileSignedOut(fileName: string): boolean {
  return fileName.endsWith('.veloq') || fileName.endsWith('.veloqdb');
}

/**
 * Hold a picked `.veloq` or `.veloqdb` file for the first signed-in launch.
 * Resolves false, keeping nothing, while the engine is open or for any other
 * file, which the caller imports as usual. Rejects, keeping nothing, for a
 * file that cannot be read or converted.
 */
export async function holdImportWhileSignedOut(
  fileUri: string,
  fileName: string
): Promise<boolean> {
  if (!importWaitsForSignIn() || !isHeldWhileSignedOut(fileName)) return false;
  const legacyJson = fileName.endsWith('.veloq');
  const jsonUri = heldUri(HELD_LEGACY_JSON);
  const zipUri = heldUri(HELD_RECORD_ZIP);
  if (!jsonUri || !zipUri) throw new Error('No documents directory to keep the backup in');

  if (legacyJson) {
    const json = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    convertLegacyBackupToRecord(json);
    await discardHeld();
    await FileSystem.writeAsStringAsync(jsonUri, json, { encoding: FileSystem.EncodingType.UTF8 });
    return true;
  }

  const recordUri = await restoreCopyUri(`hold-legacy-${Date.now()}.zip`);
  try {
    await convertLegacyDatabaseFile(fileUri, recordUri);
    await discardHeld();
    await FileSystem.moveAsync({ from: recordUri, to: zipUri });
  } finally {
    await FileSystem.deleteAsync(recordUri, { idempotent: true }).catch(() => {});
  }
  return true;
}

/** The unplaced count of a held import's restore. Rejects with the restore's refusal. */
async function restoreHeld(jsonUri: string, zipUri: string): Promise<number | null> {
  if (await exists(jsonUri)) {
    const json = await FileSystem.readAsStringAsync(jsonUri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const result = await restoreBackup(json);
    if (result.failed) throw new Error(result.error ?? 'Backup import failed');
    return result.unplacedCount ?? 0;
  }
  if (await exists(zipUri)) return (await restoreRecordBackup(zipUri)).unplaced;
  return null;
}

async function applyHeld(t: TFunction): Promise<boolean> {
  if (importWaitsForSignIn()) return false;
  const jsonUri = heldUri(HELD_LEGACY_JSON);
  const zipUri = heldUri(HELD_RECORD_ZIP);
  if (!jsonUri || !zipUri) return false;

  let unplaced: number | null;
  try {
    unplaced = await restoreHeld(jsonUri, zipUri);
  } catch (error) {
    // A record the restore refused is refused again on every try, and one a
    // write failure paused is the engine's to resume, so either way the held
    // file has had its one restore.
    const message = error instanceof Error ? error.message : '';
    log.warn('Held import not restored:', message);
    await discardHeld().catch(() => {});
    markPlatformRecordAnswered();
    Alert.alert(
      t('common.error'),
      message.includes('another athlete')
        ? t('backup.backupDifferentAccount')
        : t('backup.importError')
    );
    return true;
  }
  if (unplaced === null) return false;
  await discardHeld().catch((error) => log.warn('Held import not deleted:', error));
  // The athlete chose this backup, which answers the one restore a first
  // signed-in launch offers.
  markPlatformRecordAnswered();
  Alert.alert(t('backup.restoreComplete'), t('backup.recordRestored'));
  return true;
}

let applying: Promise<boolean> | null = null;

/**
 * Restore the held import once the engine is open, and say what came back.
 * Resolves true when one was held, whether it was placed or refused, and false
 * when none is or the engine is still closed, which keeps it for a later launch.
 */
export function applyHeldImport(t: TFunction): Promise<boolean> {
  applying ??= applyHeld(t).finally(() => {
    applying = null;
  });
  return applying;
}
