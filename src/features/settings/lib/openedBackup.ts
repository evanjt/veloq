/**
 * A backup file opened into the app from outside it: tapped in mail, Files or
 * a file manager, or shared from another app.
 *
 * The system hands it over as a link. A file opened on iOS arrives as a
 * `file:` URL to the copy iOS made in the app's `Inbox`, one opened on Android
 * as a `content:` or `file:` URI, and a share on Android as the scheme's
 * `expo-sharing` link, which names nothing and leaves the file with
 * expo-sharing. Each is restored through the import picker's own path.
 *
 * A launch hands the link over before the engine is open, so a signed-in
 * athlete's file waits here until the launch opens the engine and asks for it.
 * Signed out, the import path holds it for the first sign-in, as it does a
 * picked file.
 */

import type { TFunction } from 'i18next';
import * as FileSystem from 'expo-file-system/legacy';

import { getStoredCredentials } from '@/shared/app/AuthStore';
import { debug } from '@/shared/debug/debug';
import { restoreCopyUri } from '@/shared/storage/cacheFiles';
import { inform } from '@/shared/ui/dialog';
import { markPlatformRecordAnswered } from './autobackup/autoBackup';
import { importWaitsForSignIn } from './backup';
import { importBackupFile } from './importBackupFile';
import { takeSharedFile } from './shareFile';

const log = debug.create('OpenedBackup');

/** The extensions the import path tells apart. */
const BACKUP_EXTENSIONS = ['.zip', '.veloq', '.veloqdb'];

/** The first bytes of each kind, base64, and the name the import path reads it by. */
const SIGNATURES: readonly [string, string][] = [
  // PK\x03\x04, a zip archive's local file header.
  ['UEsDB', '.zip'],
  // "SQLite format 3", the database file header.
  ['U1FMaXRlIGZvcm1hdCAz', '.veloqdb'],
  // "{", the start of the JSON settings backup.
  ['e', '.veloq'],
];

/** Where a file came in: opened at a URI, or shared and still held by expo-sharing. */
type Opened = { kind: 'file'; uri: string } | { kind: 'share' };

/** Whether a link the system handed the app is a file opened or shared into it. */
export function openedFrom(url: string): Opened | null {
  if (/^(file|content):\/\//i.test(url)) return { kind: 'file', uri: url };
  if (/^[a-z][\w+.-]*:\/\/expo-sharing\/?$/i.test(url)) return { kind: 'share' };
  return null;
}

/** The file name a URI ends in, or an empty string when it names none. */
export function fileNameOf(uri: string): string {
  const path = uri.split(/[?#]/)[0] ?? '';
  let last = path.slice(path.lastIndexOf('/') + 1);
  try {
    last = decodeURIComponent(last);
  } catch {
    // A malformed escape is kept as it came.
  }
  // A document provider's id carries the path after a colon, encoded into one segment.
  return last.slice(Math.max(last.lastIndexOf('/'), last.lastIndexOf(':')) + 1);
}

const knownByName = (name: string) => BACKUP_EXTENSIONS.some((ext) => name.endsWith(ext));

/** The name the import path reads a copy by: its own when it says the kind, else its first bytes'. */
async function nameToImport(copyUri: string, name: string): Promise<string> {
  if (knownByName(name)) return name;
  const head = await FileSystem.readAsStringAsync(copyUri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 16,
  });
  const match = SIGNATURES.find(([signature]) => head.startsWith(signature));
  return match ? `${name || 'backup'}${match[1]}` : name;
}

/** iOS copies an opened file into the documents `Inbox`, where only the app deletes it. */
function isInboxCopy(uri: string): boolean {
  const docs = FileSystem.documentDirectory;
  return docs !== null && uri.startsWith(`${docs}Inbox/`);
}

async function importOpened(opened: Opened, t: TFunction): Promise<void> {
  const source = opened.kind === 'file' ? { uri: opened.uri, name: null } : await takeSharedFile();
  if (!source) return;
  const name = source.name || fileNameOf(source.uri);
  const copyUri = await restoreCopyUri(`opened-${Date.now()}`);
  try {
    await FileSystem.copyAsync({ from: source.uri, to: copyUri });
    const result = await importBackupFile(copyUri, await nameToImport(copyUri, name), t);
    // The athlete chose this backup, which answers the one restore a first
    // signed-in launch offers.
    if (result?.success) markPlatformRecordAnswered();
  } finally {
    await FileSystem.deleteAsync(copyUri, { idempotent: true }).catch(() => {});
    if (isInboxCopy(source.uri)) {
      await FileSystem.deleteAsync(source.uri, { idempotent: true }).catch(() => {});
    }
  }
}

let pending: Opened | null = null;
let applying: Promise<boolean> | null = null;

/**
 * Take a link the system handed the app. Answers whether it was a file opened
 * or shared into the app, which is then the latest one waiting to restore.
 */
export function receiveOpenedBackup(url: string): boolean {
  const opened = openedFrom(url);
  if (opened) pending = opened;
  return opened !== null;
}

/** Signed in, the engine opens later in the launch, which asks again. */
const waitsForEngine = () => importWaitsForSignIn() && Boolean(getStoredCredentials().athleteId);

async function applyPending(t: TFunction): Promise<boolean> {
  let took = false;
  // A file opened while another restores is taken after it.
  while (pending && !waitsForEngine()) {
    const opened = pending;
    pending = null;
    took = true;
    try {
      await importOpened(opened, t);
    } catch (error) {
      log.warn('Opened backup not read:', error instanceof Error ? error.message : error);
      inform({ title: t('backup.notRestoredTitle'), message: t('backup.importError') });
    }
  }
  return took;
}

/**
 * Restore the file waiting from `receiveOpenedBackup`, once the engine is open
 * or nobody is signed in. Resolves true when one was taken, whatever became of
 * it, and false when none waits or it waits for the engine.
 */
export function applyOpenedBackup(t: TFunction): Promise<boolean> {
  applying ??= applyPending(t).finally(() => {
    applying = null;
  });
  return applying;
}
