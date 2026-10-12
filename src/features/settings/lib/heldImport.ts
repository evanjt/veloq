/**
 * A backup picked or downloaded while nobody is signed in, kept until someone is.
 *
 * A record is checked against the signed-in athlete, so the engine places none
 * before a sign-in. An older file is read and converted when it is picked, and
 * a record zip must open as a zip archive, which refuses an unreadable one
 * before anything is kept. The result waits in
 * the documents directory, where no cache purge reaches it. The first
 * signed-in launch restores it through the record path and says what came
 * back. One is held at a time: a later pick replaces it.
 */

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
import { inform } from '@/shared/ui/dialog';
import { showRestoreNotice } from './restoreNotice';

const log = debug.create('HeldImport');

/** The held `.veloq` file, kept as picked, since its conversion is cheap and repeatable. */
const HELD_LEGACY_JSON = 'veloq-held-import.veloq';
/** The record zip held as it came, or the one a held `.veloqdb` file converted to. */
const HELD_RECORD_ZIP = 'veloq-held-import.zip';
/** A zip archive's local file header signature, PK\x03\x04, as its first base64 characters. */
const ZIP_SIGNATURE_BASE64 = 'UEsDB';

function heldUri(name: string): string | null {
  const docDir = FileSystem.documentDirectory;
  return docDir ? `${docDir}${name}` : null;
}

async function exists(uri: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists;
}

/**
 * Delete the held import, if any. Demo entry and the library wipe call it too,
 * since a held backup restores into whoever signs in next.
 */
export async function discardHeldImport(): Promise<void> {
  for (const name of [HELD_LEGACY_JSON, HELD_RECORD_ZIP]) {
    const uri = heldUri(name);
    if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

/** Whether a file of this name is held for sign-in rather than refused while signed out. */
export function isHeldWhileSignedOut(fileName: string): boolean {
  return fileName.endsWith('.veloq') || fileName.endsWith('.veloqdb') || fileName.endsWith('.zip');
}

/** Refuse a file that does not open as a zip archive, since only the engine can read further. */
async function requireZipArchive(fileUri: string): Promise<void> {
  const head = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 4,
  });
  if (!head.startsWith(ZIP_SIGNATURE_BASE64)) throw new Error('Invalid backup file format');
}

/**
 * Hold a picked or downloaded backup for the first signed-in launch. The
 * source is copied, never moved, so the caller still deletes its own file.
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
    await discardHeldImport();
    await FileSystem.writeAsStringAsync(jsonUri, json, { encoding: FileSystem.EncodingType.UTF8 });
    return true;
  }

  const recordUri = await restoreCopyUri(`hold-record-${Date.now()}.zip`);
  try {
    if (fileName.endsWith('.zip')) {
      await requireZipArchive(fileUri);
      await FileSystem.copyAsync({ from: fileUri, to: recordUri });
    } else {
      await convertLegacyDatabaseFile(fileUri, recordUri);
    }
    await discardHeldImport();
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
    await discardHeldImport().catch(() => {});
    markPlatformRecordAnswered();
    inform({
      title: t('backup.notRestoredTitle'),
      message: message.includes('another athlete')
        ? t('backup.backupDifferentAccount')
        : t('backup.importError'),
    });
    return true;
  }
  if (unplaced === null) return false;
  await discardHeldImport().catch((error) => log.warn('Held import not deleted:', error));
  // The athlete chose this backup, which answers the one restore a first
  // signed-in launch offers.
  markPlatformRecordAnswered();
  showRestoreNotice('restored', t);
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
