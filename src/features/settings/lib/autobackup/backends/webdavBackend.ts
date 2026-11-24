/**
 * WebDAV/Nextcloud backup backend.
 *
 * Pure fetch() with WebDAV HTTP methods - no external library needed.
 * User provides server URL + credentials, stored in SecureStore.
 * Backups stored in a /Veloq/ directory on the server.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { backupFileName, backupNameTimestamp } from './backupName';
import {
  backupEntryFromSidecar,
  type BackupBackend,
  type BackupEntry,
  type BackupObject,
} from './types';
import {
  getWebdavConfig,
  webdavConfigProblem,
  type WebdavConfig,
  type WebdavUrlProblem,
} from '../webdavConfig';
import { addressFailure, transferFailure, transportFailure } from './errors';
import { NET_DEADLINE_MS, fetchWithDeadline } from '@/shared/net/fetchWithDeadline';
import { basicAuthHeader } from '@/shared/net/basicAuth';
import { debug } from '@/shared/debug/debug';
import { errorMessage } from '@/shared/format/errorMessage';

const log = debug.create('WebdavBackend');

const REMOTE_DIR = 'Veloq';

/** Sidecar reads a listing keeps in flight at once: one copy a day makes a year of them. */
const SIDECAR_CONCURRENCY = 6;

/** `fn` over `items` with at most `limit` running at once, results in the order of `items`. */
async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** The stored config, or the reason nothing may be sent to it. */
function requireConfig(operation: string): WebdavConfig {
  const problem = webdavConfigProblem();
  if (problem) throw addressFailure(operation, problem);
  return getWebdavConfig() as WebdavConfig;
}

/**
 * A fetch that reports a dropped connection as transient rather than as a server
 * verdict, and that gives up rather than waiting on the platform socket timeout.
 *
 * The transfer ceiling, not the interactive one: a PROPFIND over a directory or a
 * metadata sidecar on a NAS that has just woken up is slower than a sign-in, and
 * the file transfers themselves go through `uploadAsync` and `downloadAsync`,
 * which take no signal and are not bounded here.
 */
async function request(
  operation: string,
  url: string,
  init: RequestInit,
  ms: number = NET_DEADLINE_MS.transfer
): Promise<Response> {
  try {
    return await fetchWithDeadline(url, init, ms);
  } catch (error) {
    throw transportFailure(operation, error);
  }
}

function authHeaders(username: string, password: string): Record<string, string> {
  return { Authorization: basicAuthHeader(username, password) };
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
    log.warn('Delete failed:', errorMessage(error));
  }
}

/**
 * Normalise a WebDAV URL: ensure trailing slash, handle common Nextcloud paths.
 * Exported for testing.
 */
export function normaliseWebdavUrl(url: string): string {
  let normalised = url.trim();
  // Strip trailing whitespace/slashes first for consistent handling
  normalised = normalised.replace(/\/+$/, '');

  // Common Nextcloud pattern: user gives base URL without /remote.php/dav/files/USER/
  // If URL ends with /remote.php/dav or similar incomplete path, leave it as-is
  // (the user likely knows their path).
  // But if they just give https://cloud.example.com, don't guess - they need to provide the path.

  // Ensure trailing slash (WebDAV collections should end with /)
  normalised += '/';

  return normalised;
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

/** What a connection test found, as a kind the screen words in the athlete's language. */
export type WebdavTestOutcome =
  | { kind: 'ok' }
  | { kind: 'urlProblem'; problem: WebdavUrlProblem }
  | { kind: 'unauthorised' }
  | { kind: 'methodNotAllowed' }
  | { kind: 'status'; code: number }
  | { kind: 'transport' };

export async function testWebdavConnection(): Promise<WebdavTestOutcome> {
  const problem = webdavConfigProblem();
  if (problem) return { kind: 'urlProblem', problem };
  const config = getWebdavConfig() as WebdavConfig;

  try {
    const headers = authHeaders(config.username, config.password);
    const url = normaliseWebdavUrl(config.url);
    // A person is waiting on this one, so it takes the interactive ceiling.
    const res = await fetchWithDeadline(
      url,
      {
        method: 'PROPFIND',
        headers: { ...headers, Depth: '0', 'Content-Type': 'application/xml' },
        body: PROPFIND_BODY,
      },
      NET_DEADLINE_MS.interactive
    );
    if (res.status === 207 || res.ok) return { kind: 'ok' };
    if (res.status === 401) return { kind: 'unauthorised' };
    if (res.status === 405) return { kind: 'methodNotAllowed' };
    return { kind: 'status', code: res.status };
  } catch (e) {
    log.warn('connection test failed', e instanceof Error ? e.message : e);
    return { kind: 'transport' };
  }
}

async function downloadNamed(operation: string, name: string, destPath: string): Promise<void> {
  const config = requireConfig(operation);
  const headers = authHeaders(config.username, config.password);
  const fileUrl = joinUrl(config.url, REMOTE_DIR, name);

  let result;
  try {
    result = await FileSystem.downloadAsync(fileUrl, destPath, { headers });
  } catch (error) {
    throw transportFailure(operation, error);
  }
  if (result.status !== 200) {
    throw transferFailure(operation, result.status);
  }
}

export const webdavBackend: BackupBackend = {
  id: 'webdav',
  name: 'WebDAV',
  isRemote: true,

  async isAvailable(): Promise<boolean> {
    return webdavConfigProblem() === null;
  },

  addressProblem(): boolean {
    return getWebdavConfig() !== null && webdavConfigProblem() !== null;
  },

  async listBackups(): Promise<BackupEntry[]> {
    const config = requireConfig('List backups');

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

    const hrefs = extractHrefs(xml);
    const sidecars = await mapBounded(
      hrefs.filter((href) => href.endsWith('.meta.json')),
      SIDECAR_CONCURRENCY,
      async (metaHref) => {
        try {
          const metaUrl = resolveHref(config.url, metaHref);
          if (!metaUrl) return null;
          const metaRes = await fetchWithDeadline(metaUrl, { headers }, NET_DEADLINE_MS.transfer);
          if (!metaRes.ok) return null;
          return backupEntryFromSidecar(await metaRes.json());
        } catch {
          // Skip corrupt metadata
          return null;
        }
      }
    );
    for (const meta of sidecars) if (meta) entries.push(meta);

    // A zip with no sidecar a listing could read, one the athlete put in the
    // folder among them, lists by the instant its name carries.
    const listed = new Set(entries.map((entry) => entry.id));
    for (const href of hrefs) {
      if (!resolveHref(config.url, href)) continue;
      const name = href.replace(/\/+$/, '').split('/').pop() ?? '';
      const timestamp = backupNameTimestamp(name);
      if (!timestamp || listed.has(name)) continue;
      listed.add(name);
      entries.push({ id: name, timestamp, sizeBytes: 0, appVersion: '' });
    }

    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return entries;
  },

  async upload(localPath: string, metadata: Omit<BackupEntry, 'id'>): Promise<string> {
    const config = requireConfig('Upload backup');

    const headers = authHeaders(config.username, config.password);
    await ensureRemoteDir(config.url, headers);

    const filename = backupFileName(metadata.timestamp);
    const fileUrl = joinUrl(config.url, REMOTE_DIR, filename);

    // uploadAsync resolves with the status instead of rejecting, so an
    // unchecked call reports a rejected write as a completed backup.
    let uploadResult;
    try {
      uploadResult = await FileSystem.uploadAsync(fileUrl, localPath, {
        httpMethod: 'PUT',
        headers,
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
    } catch (error) {
      throw transportFailure('Upload backup', error);
    }
    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      throw transferFailure('Upload backup', uploadResult.status);
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
    return filename;
  },

  async download(backupId: string, destPath: string): Promise<void> {
    await downloadNamed('Download backup', backupId, destPath);
  },

  async delete(backupId: string): Promise<void> {
    if (webdavConfigProblem()) return;
    const config = getWebdavConfig() as WebdavConfig;

    const headers = authHeaders(config.username, config.password);
    const fileUrl = joinUrl(config.url, REMOTE_DIR, backupId);

    await deleteQuietly(fileUrl, headers);
    await deleteQuietly(`${fileUrl}.meta.json`, headers);
  },

  /** One PUT, which replaces an object of the same name. The manifest is the listing, so no sidecar. */
  async putObject(name: string, localPath: string): Promise<void> {
    const operation = 'Upload backup object';
    const config = requireConfig(operation);
    const headers = authHeaders(config.username, config.password);
    await ensureRemoteDir(config.url, headers);

    let result;
    try {
      result = await FileSystem.uploadAsync(joinUrl(config.url, REMOTE_DIR, name), localPath, {
        httpMethod: 'PUT',
        headers,
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
    } catch (error) {
      throw transportFailure(operation, error);
    }
    if (result.status < 200 || result.status >= 300) {
      throw transferFailure(operation, result.status);
    }
  },

  async listObjects(prefix: string): Promise<BackupObject[]> {
    const operation = 'List backup objects';
    const config = requireConfig(operation);
    const headers = authHeaders(config.username, config.password);
    const res = await request(operation, joinUrl(config.url, REMOTE_DIR), {
      method: 'PROPFIND',
      headers: { ...headers, Depth: '1', 'Content-Type': 'application/xml' },
      body: PROPFIND_SIZE_BODY,
    });
    // 404 is a directory not created yet, which is an empty list.
    if (res.status === 404) return [];
    if (!res.ok && res.status !== 207) throw transferFailure(operation, res.status);

    const objects: BackupObject[] = [];
    for (const { href, sizeBytes } of extractResponses(await res.text())) {
      if (!resolveHref(config.url, href)) continue;
      const name = href.replace(/\/+$/, '').split('/').pop() ?? '';
      if (name.startsWith(prefix)) objects.push({ name, sizeBytes });
    }
    return objects;
  },

  async fetchObject(name: string, destPath: string): Promise<void> {
    await downloadNamed('Download backup object', name, destPath);
  },
};

const PROPFIND_SIZE_BODY = `<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/></d:prop></d:propfind>`;

/** Each response of a PROPFIND reply: its decoded href and its content length, 0 when absent. */
function extractResponses(xml: string): { href: string; sizeBytes: number }[] {
  const responses: { href: string; sizeBytes: number }[] = [];
  const block = /<(?:[\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi;
  let match;
  while ((match = block.exec(xml)) !== null) {
    const inner = match[1] ?? '';
    const [href] = extractHrefs(inner);
    if (href === undefined) continue;
    const length = /<(?:[\w.-]+:)?getcontentlength\b[^>]*>\s*(\d+)\s*</i.exec(inner);
    responses.push({ href, sizeBytes: length ? Number(length[1]) : 0 });
  }
  return responses;
}

/**
 * Extract href values from a PROPFIND XML response. The server picks the
 * prefix it binds DAV: to, so any prefix matches. An href that does not
 * decode is skipped rather than failing the whole listing.
 */
function extractHrefs(xml: string): string[] {
  const hrefs: string[] = [];
  const regex = /<(?:[\w.-]+:)?href\b[^>]*>([^<]+)<\/(?:[\w.-]+:)?href>/gi;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    try {
      hrefs.push(decodeURIComponent(match[1] ?? ''));
    } catch {
      // Malformed percent-encoding names no file this app wrote.
    }
  }
  return hrefs;
}

/**
 * Resolve an href against the server base URL, or null when it names another
 * origin. The credential goes only to the address the athlete configured.
 */
function resolveHref(baseUrl: string, href: string): string | null {
  let base: URL;
  let resolved: URL;
  try {
    base = new URL(baseUrl);
    resolved = new URL(href, base);
  } catch {
    return null;
  }
  return resolved.origin === base.origin ? resolved.href : null;
}
