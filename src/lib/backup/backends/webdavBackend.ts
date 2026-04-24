/**
 * WebDAV/Nextcloud backup backend.
 *
 * Pure fetch() with WebDAV HTTP methods — no external library needed.
 * User provides server URL + credentials, stored in SecureStore.
 * Backups stored in a /Veloq/ directory on the server.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { BackupBackend, BackupEntry } from './types';
import { getWebdavConfig } from '../webdavConfig';

const REMOTE_DIR = 'Veloq';

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
  // But if they just give https://cloud.example.com, don't guess — they need to provide the path.

  // Ensure trailing slash (WebDAV collections should end with /)
  normalized += '/';

  return normalized;
}

async function ensureRemoteDir(baseUrl: string, headers: Record<string, string>): Promise<void> {
  const dirUrl = joinUrl(baseUrl, REMOTE_DIR);
  // MKCOL creates the directory — 201 = created, 405 = already exists, both are fine
  const res = await fetch(dirUrl, { method: 'MKCOL', headers });
  if (res.status !== 201 && res.status !== 405 && res.status !== 301) {
    // 301 is sometimes returned for existing collections
    if (res.status === 401) throw new Error('Authentication failed');
    // Check if it already exists with PROPFIND
    const check = await fetch(dirUrl, {
      method: 'PROPFIND',
      headers: { ...headers, Depth: '0', 'Content-Type': 'application/xml' },
      body: PROPFIND_BODY,
    });
    if (!check.ok && check.status !== 207) {
      throw new Error(`Failed to create remote directory (${res.status})`);
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
      return 'Check your WebDAV URL format — the server does not accept PROPFIND at this path';
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

    const res = await fetch(dirUrl, {
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

    if (!res.ok && res.status !== 207) return [];

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

    // Upload the database file
    await FileSystem.uploadAsync(fileUrl, localPath, {
      httpMethod: 'PUT',
      headers,
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    });

    // Upload metadata sidecar
    const entry: BackupEntry = { ...metadata, id: filename };
    const metaUrl = `${fileUrl}.meta.json`;
    await fetch(metaUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(entry, null, 2),
    });
  },

  async download(backupId: string, destPath: string): Promise<void> {
    const config = getWebdavConfig();
    if (!config) throw new Error('No WebDAV server configured');

    const headers = authHeaders(config.username, config.password);
    const fileUrl = joinUrl(config.url, REMOTE_DIR, backupId);

    const result = await FileSystem.downloadAsync(fileUrl, destPath, { headers });
    if (result.status !== 200) {
      throw new Error(`Download failed (${result.status})`);
    }
  },

  async delete(backupId: string): Promise<void> {
    const config = getWebdavConfig();
    if (!config) return;

    const headers = authHeaders(config.username, config.password);
    const fileUrl = joinUrl(config.url, REMOTE_DIR, backupId);

    await fetch(fileUrl, { method: 'DELETE', headers });
    await fetch(`${fileUrl}.meta.json`, { method: 'DELETE', headers });
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
