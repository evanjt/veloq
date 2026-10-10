/**
 * Veloq's own app data folder in the athlete's Google Drive, on Android.
 *
 * The folder is hidden from the Drive interface and reachable only by Veloq,
 * under the `drive.appdata` scope alone. Each run adds one
 * `veloq-<timestamp>.zip`, named as the folder carrier names them, and nothing
 * here deletes one on its own: what the folder keeps is the athlete's to
 * manage. A backup's id is its file name, as on every other carrier, since a
 * restore routes on the name; the Drive file id is looked up from it.
 *
 * The athlete signs in once, from the backup screen or the login screen's
 * restore choices. After that every request takes a token from a silent
 * authorisation, and one that would need the consent screen fails the run
 * with the `signin` kind instead of showing it.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { NET_DEADLINE_MS, fetchWithDeadline } from '@/shared/net/fetchWithDeadline';
import {
  GOOGLE_SIGN_IN_CANCELLED,
  GOOGLE_SIGN_IN_NEEDED,
  authorizeGoogleDrive,
  clearGoogleDriveToken,
  googleAuthorizationCode,
  isGoogleDriveSupported,
} from '@/shared/native/googleDrive';
import { safeGetTime } from '@/shared/format/format';
import { debug } from '@/shared/debug/debug';
import {
  clearGoogleDriveAccount,
  getGoogleDriveAccount,
  holdGoogleDriveAccount,
  loadGoogleDriveAccount,
} from '../googleDriveAccount';
import { BackupTransferError, classifyStatus, transportFailure } from './errors';
import { backupFileName, backupNameTimestamp } from './backupName';
import type { BackupBackend, BackupEntry } from './types';

export { getGoogleDriveAccount, isGoogleDriveSupported, loadGoogleDriveAccount };

const log = debug.create('GoogleDriveBackend');

const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const APP_DATA = 'appDataFolder';

/** The Drive file id behind each name this process wrote or listed. */
const fileIds = new Map<string, string>();

/** Reasons Drive gives with a 403 for a full Drive rather than a refused grant. */
const QUOTA_REASONS = new Set(['storageQuotaExceeded', 'quotaExceeded']);
/** Reasons Drive gives with a 403 for a rate limit, which passes on its own. */
const RATE_REASONS = new Set(['userRateLimitExceeded', 'rateLimitExceeded']);

/** The first reason Drive's error body names, or null. */
function errorReason(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { errors?: { reason?: unknown }[]; status?: unknown };
    };
    const reason = parsed.error?.errors?.[0]?.reason;
    return typeof reason === 'string' ? reason : null;
  } catch {
    return null;
  }
}

/**
 * A refusal from Drive as a kind the athlete can act on. 401 is a token Drive
 * no longer takes, so a sign-in. A 403 is a full Drive, a rate limit, or a
 * grant that does not cover the request, which a sign-in also mends.
 */
function driveFailure(operation: string, status: number, body = ''): BackupTransferError {
  let kind = classifyStatus(status);
  if (status === 401) kind = 'signin';
  if (status === 403) {
    const reason = errorReason(body);
    if (reason && QUOTA_REASONS.has(reason)) kind = 'quota';
    else if (reason && RATE_REASONS.has(reason)) kind = 'server';
    else kind = 'signin';
  }
  return new BackupTransferError(operation, kind, `${operation} failed (${status})`, status);
}

/** A token for a request in a run, which never shows the consent screen. */
async function accessToken(operation: string): Promise<string> {
  try {
    return await authorizeGoogleDrive(false);
  } catch (error) {
    if (googleAuthorizationCode(error) === GOOGLE_SIGN_IN_NEEDED) {
      throw new BackupTransferError(
        operation,
        'signin',
        `${operation} failed: Google needs the athlete to sign in again`
      );
    }
    throw transportFailure(operation, error);
  }
}

/**
 * A refused token is dropped from Play services' cache, so the next request
 * asks for a fresh one rather than being handed the same one again.
 */
function forgetRefusedToken(token: string, failure: BackupTransferError): void {
  if (failure.kind !== 'signin') return;
  clearGoogleDriveToken(token).catch(() => {});
}

/** A request to Drive with its body read, a dropped connection reported as passing. */
async function request(
  operation: string,
  url: string,
  init: RequestInit,
  ms: number = NET_DEADLINE_MS.transfer
): Promise<{ status: number; ok: boolean; body: string }> {
  try {
    const res = await fetchWithDeadline(url, init, ms);
    return { status: res.status, ok: res.ok, body: await res.text() };
  } catch (error) {
    throw transportFailure(operation, error);
  }
}

/** One authorised call that has to succeed, its JSON body parsed. */
async function driveCall<T>(
  operation: string,
  url: string,
  init: RequestInit = {},
  token?: string
): Promise<T> {
  const bearer = token ?? (await accessToken(operation));
  const res = await request(operation, url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${bearer}` },
  });
  if (!res.ok) {
    const failure = driveFailure(operation, res.status, res.body);
    forgetRefusedToken(bearer, failure);
    throw failure;
  }
  if (!res.body) return {} as T;
  try {
    return JSON.parse(res.body) as T;
  } catch {
    // A body that is not JSON came from something between the device and Drive.
    throw new BackupTransferError(operation, 'server', `${operation} failed: unreadable reply`);
  }
}

interface DriveFile {
  id: string;
  name: string;
  createdTime?: string;
  size?: string;
}

/** Every file in the app data folder, newest first, optionally only those of one name. */
async function listAppData(operation: string, name?: string): Promise<DriveFile[]> {
  const token = await accessToken(operation);
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      spaces: APP_DATA,
      fields: 'nextPageToken,files(id,name,createdTime,size)',
      orderBy: 'createdTime desc',
      pageSize: '100',
    });
    if (name) params.set('q', `name = '${name.replace(/['\\]/g, '\\$&')}'`);
    if (pageToken) params.set('pageToken', pageToken);
    const page = await driveCall<{ files?: DriveFile[]; nextPageToken?: string }>(
      operation,
      `${DRIVE}/files?${params.toString()}`,
      {},
      token
    );
    for (const file of page.files ?? []) {
      fileIds.set(file.name, file.id);
      files.push(file);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

/** The Drive file id of a backup by its name. */
async function fileIdOf(operation: string, name: string): Promise<string> {
  const known = fileIds.get(name);
  if (known) return known;
  const [file] = await listAppData(operation, name);
  if (!file) {
    throw new BackupTransferError(
      operation,
      'path',
      `${operation} failed: ${name} is not in Drive`
    );
  }
  return file.id;
}

/**
 * Show Google's account picker and consent screen for the app data folder and
 * hold the account chosen. Returns its email address, or null when the athlete
 * dismissed the picker, in which case the account held before stays as it was.
 */
export async function signInToGoogleDrive(): Promise<string | null> {
  if (!isGoogleDriveSupported()) throw new Error('Google Drive is not available on this device');
  let token: string;
  try {
    token = await authorizeGoogleDrive(true);
  } catch (error) {
    if (googleAuthorizationCode(error) === GOOGLE_SIGN_IN_CANCELLED) return null;
    throw error;
  }
  // The address is only the row's label, so a lookup that fails still signs in.
  let email = 'Google Drive';
  try {
    const about = await driveCall<{ user?: { emailAddress?: string } }>(
      'Sign in to Google Drive',
      `${DRIVE}/about?fields=user(emailAddress)`,
      {},
      token
    );
    email = about.user?.emailAddress || email;
  } catch (error) {
    log.warn(
      'Could not read the Google account address:',
      error instanceof Error ? error.message : error
    );
  }
  await holdGoogleDriveAccount(email);
  return email;
}

/**
 * Forget the account and give the grant back to Google, so a later sign-in
 * asks again. The backups in the folder are the athlete's and stay. The
 * account is forgotten at once; the revocation follows, and one that cannot
 * reach Google leaves a grant only Veloq can use, which the athlete can remove
 * from their Google account.
 */
export function forgetGoogleDrive(): Promise<void> {
  const held = getGoogleDriveAccount() !== null;
  const cleared = clearGoogleDriveAccount().catch(() => {});
  if (!held || !isGoogleDriveSupported()) return cleared;
  const revoked = (async () => {
    const token = await authorizeGoogleDrive(false);
    await fetchWithDeadline(REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(token)}`,
    });
    await clearGoogleDriveToken(token);
  })().catch((error) => {
    log.warn(
      'Could not revoke the Google Drive grant:',
      error instanceof Error ? error.message : error
    );
  });
  fileIds.clear();
  return Promise.all([cleared, revoked]).then(() => undefined);
}

export const googleDriveBackend: BackupBackend = {
  id: 'googleDrive',
  name: 'Google Drive',
  isRemote: true,

  async isAvailable(): Promise<boolean> {
    if (!isGoogleDriveSupported()) return false;
    return (await loadGoogleDriveAccount()) !== null;
  },

  async listBackups(): Promise<BackupEntry[]> {
    const files = await listAppData('List backups');
    const entries: BackupEntry[] = [];
    for (const file of files) {
      const timestamp = backupNameTimestamp(file.name);
      if (timestamp) {
        entries.push({
          id: file.name,
          timestamp,
          sizeBytes: Number(file.size) || 0,
          appVersion: '',
        });
      }
    }
    entries.sort((a, b) => safeGetTime(new Date(b.timestamp)) - safeGetTime(new Date(a.timestamp)));
    return entries;
  },

  /**
   * Create the file's metadata in the app data folder, then send its content
   * from disk, so the zip streams from the file rather than through memory. A
   * content upload that fails takes this run's empty file with it.
   */
  async upload(localPath: string, metadata: Omit<BackupEntry, 'id'>): Promise<string> {
    const operation = 'Upload backup';
    const name = backupFileName(metadata.timestamp);
    const token = await accessToken(operation);
    const created = await driveCall<{ id: string }>(
      operation,
      `${DRIVE}/files?fields=id`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parents: [APP_DATA], mimeType: 'application/zip' }),
      },
      token
    );

    let failure: BackupTransferError | null = null;
    try {
      const result = await FileSystem.uploadAsync(
        `${DRIVE_UPLOAD}/files/${encodeURIComponent(created.id)}?uploadType=media`,
        localPath,
        {
          httpMethod: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' },
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        }
      );
      if (result.status < 200 || result.status >= 300) {
        failure = driveFailure(operation, result.status, result.body);
        forgetRefusedToken(token, failure);
      }
    } catch (error) {
      failure = transportFailure(operation, error);
    }
    if (failure) {
      await request('Delete partial backup', `${DRIVE}/files/${encodeURIComponent(created.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      throw failure;
    }
    fileIds.set(name, created.id);
    return name;
  },

  async download(backupId: string, destPath: string): Promise<void> {
    const operation = 'Download backup';
    const token = await accessToken(operation);
    const id = await fileIdOf(operation, backupId);
    let result;
    try {
      result = await FileSystem.downloadAsync(
        `${DRIVE}/files/${encodeURIComponent(id)}?alt=media`,
        destPath,
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      throw transportFailure(operation, error);
    }
    if (result.status !== 200) {
      if (result.status === 404) fileIds.delete(backupId);
      const failure = driveFailure(operation, result.status);
      forgetRefusedToken(token, failure);
      throw failure;
    }
  },

  async delete(backupId: string): Promise<void> {
    const operation = 'Delete backup';
    const id = await fileIdOf(operation, backupId);
    await driveCall(operation, `${DRIVE}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    fileIds.delete(backupId);
  },
};
