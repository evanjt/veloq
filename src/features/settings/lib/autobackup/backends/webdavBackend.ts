/**
 * WebDAV/Nextcloud backup backend.
 *
 * Pure fetch() with WebDAV HTTP methods - no external library needed.
 * User provides server URL + credentials, stored in SecureStore.
 * Backups stored in a /Veloq/ directory on the server.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { BackupBackend, BackupEntry } from './types';
import { getWebdavConfig } from '../webdavConfig';
import { transferFailure, transportFailure } from './errors';
import { debug } from '@/shared/debug/debug';

const log = debug.create('WebdavBackend');

const REMOTE_DIR = 'Veloq';

/** A fetch that reports a dropped connection as transient rather than as a server verdict. */
async function request(operation: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw transportFailure(operation, error);
  }
}

function authHeaders(username: string, password: string): Record<string, string> {
  const encoded = btoa(`${username}:${password}`);
  return { Authorization: `Basic ${encoded}` };
}

function joinUrl(base: string, ...parts: string[]): string {
  const trimmed = base.replace(/\/+$/, '');
  const joined = parts.map((p) => p.replace(/^\/+|\/+$/g, '')).join('/');
  return `${trimmed}/${joined}`;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`;

/**
 * Retention is best effort, but a delete that always fails grows the remote
 * directory forever with no signal, so it is worth a line in the log.
 */
async function deleteQuietly(url: string, headers: Record<string, string>): Promise<void> {
  try {
    const res = await request('Delete backup', url, { method: 'DELETE', headers });
    // 404 means it is already gone, which is the outcome we wanted
    if (!res.ok && res.status !== 404) {
      log.warn(`Delete rejected (${res.status}): ${url}`);
    }
  } catch (error) {
    log.warn('Delete failed:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Normalize a WebDAV URL: ensure trailing slash, handle common Nextcloud paths.
 * Exported for testing.
 */
export function normalizeWebdavUrl(url: string): string {
  let normalized = url.trim();
  // Strip trailing whitespace/slashes first for consistent handling
  normalized = normalized.replace(/\/+$/, '');

  // Common Nextcloud pattern: user gives base URL without /remote.php/dav/files/USER/
  // If URL ends with /remote.php/dav or similar incomplete path, leave it as-is
  // (the user likely knows their path).
  // But if they just give https://cloud.example.com, don't guess - they need to provide the path.

  // Ensure trailing slash (WebDAV collections should end with /)
  normalized += '/';

  return normalized;
}

async function ensureRemoteDir(baseUrl: string, headers: Record<string, string>): Promise<void> {
  const dirUrl = joinUrl(baseUrl, REMOTE_DIR);
  // MKCOL creates the directory - 201 = created, 405 = already exists, both are fine
  const res = await request('Create remote directory', dirUrl, { method: 'MKCOL', headers });
  if (res.status !== 201 && res.status !== 405 && res.status !== 301) {
    // 301 is sometimes returned for existing collections
    if (res.status === 401 || res.status === 403) {
      throw transferFailure('Create remote directory', res.status);
    }
    // Check if it already exists with PROPFIND
    const check = await request('Create remote directory', dirUrl, {
      method: 'PROPFIND',
      headers: { ...headers, Depth: '0', 'Content-Type': 'application/xml' },
      body: PROPFIND_BODY,
    });
    if (!check.ok && check.status !== 207) {
      throw transferFailure('Create remote directory', res.status);
    }
  }
}

/** Test connection to the WebDAV server. Returns null on success, error message on failure. */
export async function testWebdavConnection(): Promise<string | null> {
  const config = getWebdavConfig();
  if (!config) return 'No WebDAV server configured';

  try {
    const headers = authHeaders(config.username, config.password);
    const url = normalizeWebdavUrl(config.url);
    const res = await fetch(url, {
      method: 'PROPFIND',
      headers: { ...headers, Depth: '0', 'Content-Type': 'application/xml' },
      body: PROPFIND_BODY,
    });
    if (res.status === 207 || res.ok) return null;
    if (res.status === 401) return 'Authentication failed';
    if (res.status === 405)
      return 'Check your WebDAV URL format - the server does not accept PROPFIND at this path';
    return `Server returned ${res.status}`;
  } catch (e) {
    return e instanceof Error ? e.message : 'Connection failed';
  }
}

export const webdavBackend: BackupBackend = {
  id: 'webdav',
  name: 'WebDAV',

  async isAvailable(): Promise<boolean> {
    return getWebdavConfig() !== null;
  },

  async listBackups(): Promise<BackupEntry[]> {
    const config = getWebdavConfig();
    if (!config) return [];

    const headers = authHeaders(config.username, config.password);
    const dirUrl = joinUrl(config.url, REMOTE_DIR);

    const res = await request('List backups', dirUrl, {
      method: 'PROPFIND',
      headers: { ...headers, Depth: '1', 'Content-Type': 'application/xml' },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:getcontentlength/>
    <d:getlastmodified/>
  </d:prop>
</d:propfind>`,
    });

    // 404 means the directory has not been created yet, which is an empty list
    // rather than a fault. Everything else the server rejects is reported, so
    // a wrong password cannot read as "no backups".
    if (res.status === 404) return [];
    if (!res.ok && res.status !== 207) throw transferFailure('List backups', res.status);

    const xml = await res.text();
    const entries: BackupEntry[] = [];

    // Parse PROPFIND response for .meta.json files
    const metaFiles = extractHrefs(xml).filter((href) => href.endsWith('.meta.json'));

    for (const metaHref of metaFiles) {
      try {
        const metaUrl = resolveHref(config.url, metaHref);
        const metaRes = await fetch(metaUrl, { headers });
        if (!metaRes.ok) continue;
        const meta = (await metaRes.json()) as BackupEntry;
        entries.push(meta);
      } catch {
        // Skip corrupt metadata
      }
    }

    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return entries;
  },

  async upload(localPath: string, metadata: Omit<BackupEntry, 'id'>): Promise<void> {
    const config = getWebdavConfig();
    if (!config) throw new Error('No WebDAV server configured');

    const headers = authHeaders(config.username, config.password);
    await ensureRemoteDir(config.url, headers);

    const filename = `veloq-${metadata.timestamp.replace(/[:.]/g, '-')}.veloqdb`;
    const fileUrl = joinUrl(config.url, REMOTE_DIR, filename);

    // uploadAsync resolves with the status instead of rejecting, so an
    // unchecked call reports a rejected write as a completed backup.
    let dbResult;
    try {
      dbResult = await FileSystem.uploadAsync(fileUrl, localPath, {
        httpMethod: 'PUT',
        headers,
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
    } catch (error) {
      throw transportFailure('Upload backup', error);
    }
    if (dbResult.status < 200 || dbResult.status >= 300) {
      throw transferFailure('Upload backup', dbResult.status);
    }

    // Upload metadata sidecar. Without it the backup is invisible to
    // listBackups, so a rejected sidecar is a failed backup too.
    const entry: BackupEntry = { ...metadata, id: filename };
    const metaUrl = `${fileUrl}.meta.json`;
    const metaRes = await request('Upload backup metadata', metaUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(entry, null, 2),
    });
    if (!metaRes.ok) {
      throw transferFailure('Upload backup metadata', metaRes.status);
    }
  },

  async download(backupId: string, destPath: string): Promise<void> {
    const config = getWebdavConfig();
    if (!config) throw new Error('No WebDAV server configured');

    const headers = authHeaders(config.username, config.password);
    const fileUrl = joinUrl(config.url, REMOTE_DIR, backupId);

    let result;
    try {
      result = await FileSystem.downloadAsync(fileUrl, destPath, { headers });
    } catch (error) {
      throw transportFailure('Download backup', error);
    }
    if (result.status !== 200) {
      throw transferFailure('Download backup', result.status);
    }
  },

  async delete(backupId: string): Promise<void> {
    const config = getWebdavConfig();
    if (!config) return;

    const headers = authHeaders(config.username, config.password);
    const fileUrl = joinUrl(config.url, REMOTE_DIR, backupId);

    await deleteQuietly(fileUrl, headers);
    await deleteQuietly(`${fileUrl}.meta.json`, headers);
  },
};

/** Extract href values from a PROPFIND XML response. */
function extractHrefs(xml: string): string[] {
  const hrefs: string[] = [];
  const regex = /<(?:d:|D:)?href>([^<]+)<\/(?:d:|D:)?href>/gi;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    hrefs.push(decodeURIComponent(match[1]));
  }
  return hrefs;
}

/** Resolve a potentially-relative href against the server base URL. */
function resolveHref(baseUrl: string, href: string): string {
  if (href.startsWith('http')) return href;
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}${href}`;
}
