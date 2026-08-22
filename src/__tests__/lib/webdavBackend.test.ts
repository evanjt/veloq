/**
 * Scenario: the WebDAV backend talks to a server that can reject any write.
 * Expected behaviour: a rejected write is a failed backup, carrying a kind the
 * settings screen can turn into advice. Only auth, quota and path problems are
 * permanent, so a 5xx or a dropped connection stays retryable.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { webdavBackend } from '@/features/settings/lib/autobackup/backends/webdavBackend';
import { isBackupTransferError } from '@/features/settings/lib/autobackup/backends/errors';
import type { BackupEntry } from '@/features/settings/lib/autobackup/backends/types';
import {
  setWebdavConfig,
  clearWebdavConfig,
} from '@/features/settings/lib/autobackup/webdavConfig';

const mockWarn = jest.fn();

// The factory runs before the const above is initialised, so warn delegates lazily
jest.mock('@/shared/debug/debug', () => {
  const noop = () => {};
  const logger = { log: noop, warn: (...args: unknown[]) => mockWarn(...args), error: noop };
  return { debug: { ...logger, create: () => logger } };
});

jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: jest.fn(),
  downloadAsync: jest.fn(),
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));

const SERVER = 'https://cloud.example.com/remote.php/dav/files/evan/';
const uploadAsync = FileSystem.uploadAsync as jest.Mock;
const downloadAsync = FileSystem.downloadAsync as jest.Mock;

function response(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

/** Route responses by HTTP method, with the MKCOL that every upload starts with. */
function routeFetch(routes: Record<string, (url: string) => Response>) {
  const fetchMock = jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const handler = routes[method];
    if (!handler) throw new Error(`Unexpected ${method} ${url}`);
    return handler(url);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const METADATA: Omit<BackupEntry, 'id'> = {
  timestamp: '2026-08-05T10:00:00.000Z',
  sizeBytes: 4096,
  appVersion: '0.4.0',
  schemaVersion: 14,
  activityCount: 312,
  athleteId: 'i12345',
};

function propfind(hrefs: string[]): string {
  const entries = hrefs
    .map((href, index) =>
      index % 2 === 0
        ? `<d:response><d:href>${href}</d:href></d:response>`
        : `<D:response><D:href>${href}</D:href></D:response>`
    )
    .join('');
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries}</d:multistatus>`;
}

function entryJson(id: string, timestamp: string): string {
  return JSON.stringify({ ...METADATA, id, timestamp });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await setWebdavConfig(SERVER, 'evan', 'app-password');
});

afterEach(async () => {
  await clearWebdavConfig();
});

describe('webdavBackend.upload', () => {
  it('writes the database and its sidecar when the server accepts both', async () => {
    uploadAsync.mockResolvedValue({ status: 201 });
    const fetchMock = routeFetch({
      MKCOL: () => response(405),
      PUT: () => response(201),
    });

    await expect(
      webdavBackend.upload('/cache/snapshot.veloqdb', METADATA)
    ).resolves.toBeUndefined();

    const [fileUrl, localPath, options] = uploadAsync.mock.calls[0];
    expect(fileUrl).toBe(`${SERVER}Veloq/veloq-2026-08-05T10-00-00-000Z.veloqdb`);
    expect(localPath).toBe('/cache/snapshot.veloqdb');
    expect(options.httpMethod).toBe('PUT');
    expect(options.headers.Authorization).toMatch(/^Basic /);

    const sidecar = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(sidecar?.[0]).toMatch(/\.veloqdb\.meta\.json$/);
    expect(JSON.parse(String(sidecar?.[1]?.body)).id).toBe(
      'veloq-2026-08-05T10-00-00-000Z.veloqdb'
    );
  });

  it('fails when the database PUT is rejected with 401', async () => {
    uploadAsync.mockResolvedValue({ status: 401 });
    const fetchMock = routeFetch({ MKCOL: () => response(405), PUT: () => response(201) });

    const error = await webdavBackend.upload('/cache/snapshot.veloqdb', METADATA).catch((e) => e);

    expect(isBackupTransferError(error)).toBe(true);
    expect(error.kind).toBe('auth');
    expect(error.status).toBe(401);
    expect(error.permanent).toBe(true);
    // The sidecar must not be written for a database that never landed
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('fails when the sidecar PUT is rejected with 401', async () => {
    uploadAsync.mockResolvedValue({ status: 201 });
    routeFetch({ MKCOL: () => response(405), PUT: () => response(401) });

    const error = await webdavBackend.upload('/cache/snapshot.veloqdb', METADATA).catch((e) => e);

    expect(isBackupTransferError(error)).toBe(true);
    expect(error.kind).toBe('auth');
    expect(error.permanent).toBe(true);
    expect(uploadAsync).toHaveBeenCalledTimes(1);
  });

  it('reports 507 as a permanent quota failure', async () => {
    uploadAsync.mockResolvedValue({ status: 507 });
    routeFetch({ MKCOL: () => response(405), PUT: () => response(201) });

    const error = await webdavBackend.upload('/cache/snapshot.veloqdb', METADATA).catch((e) => e);

    expect(error.kind).toBe('quota');
    expect(error.status).toBe(507);
    expect(error.permanent).toBe(true);
  });

  it('reports 503 as a transient server failure', async () => {
    uploadAsync.mockResolvedValue({ status: 503 });
    routeFetch({ MKCOL: () => response(405), PUT: () => response(201) });

    const error = await webdavBackend.upload('/cache/snapshot.veloqdb', METADATA).catch((e) => e);

    expect(error.kind).toBe('server');
    expect(error.permanent).toBe(false);
  });

  it('reports a dropped connection as transient rather than as a server verdict', async () => {
    uploadAsync.mockRejectedValue(new Error('Network request failed'));
    routeFetch({ MKCOL: () => response(405) });

    const error = await webdavBackend.upload('/cache/snapshot.veloqdb', METADATA).catch((e) => e);

    expect(error.kind).toBe('transport');
    expect(error.permanent).toBe(false);
  });
});

describe('webdavBackend.listBackups', () => {
  it('reads sidecars from a 207 with mixed namespace prefixes and relative hrefs', async () => {
    const xml = propfind([
      '/remote.php/dav/files/evan/Veloq/',
      '/remote.php/dav/files/evan/Veloq/veloq-old.veloqdb.meta.json',
      'https://cloud.example.com/remote.php/dav/files/evan/Veloq/veloq-new.veloqdb.meta.json',
    ]);
    const fetchMock = routeFetch({
      PROPFIND: () => response(207, xml),
      GET: (url) =>
        url.includes('veloq-old')
          ? response(200, entryJson('veloq-old.veloqdb', '2026-08-01T10:00:00.000Z'))
          : response(200, entryJson('veloq-new.veloqdb', '2026-08-05T10:00:00.000Z')),
    });

    const entries = await webdavBackend.listBackups();

    expect(entries.map((e) => e.id)).toEqual(['veloq-new.veloqdb', 'veloq-old.veloqdb']);
    const fetched = fetchMock.mock.calls.filter(([, init]) => !init?.method).map(([url]) => url);
    expect(fetched).toContain(
      'https://cloud.example.com/remote.php/dav/files/evan/Veloq/veloq-old.veloqdb.meta.json'
    );
  });

  it('reports a rejected PROPFIND instead of returning an empty list', async () => {
    routeFetch({ PROPFIND: () => response(401) });

    const error = await webdavBackend.listBackups().catch((e) => e);

    expect(isBackupTransferError(error)).toBe(true);
    expect(error.kind).toBe('auth');
    expect(error.permanent).toBe(true);
  });

  it('treats a missing remote directory as an empty list', async () => {
    routeFetch({ PROPFIND: () => response(404) });

    await expect(webdavBackend.listBackups()).resolves.toEqual([]);
  });

  it('skips a corrupt sidecar without losing the rest of the listing', async () => {
    const xml = propfind([
      '/remote.php/dav/files/evan/Veloq/veloq-broken.veloqdb.meta.json',
      '/remote.php/dav/files/evan/Veloq/veloq-good.veloqdb.meta.json',
    ]);
    routeFetch({
      PROPFIND: () => response(207, xml),
      GET: (url) =>
        url.includes('veloq-broken')
          ? response(200, 'not json at all')
          : response(200, entryJson('veloq-good.veloqdb', '2026-08-05T10:00:00.000Z')),
    });

    const entries = await webdavBackend.listBackups();

    expect(entries.map((e) => e.id)).toEqual(['veloq-good.veloqdb']);
  });
});

describe('webdavBackend.download', () => {
  it('fails on a non-200 response', async () => {
    downloadAsync.mockResolvedValue({ status: 404 });

    const error = await webdavBackend.download('veloq-old.veloqdb', '/cache/out').catch((e) => e);

    expect(isBackupTransferError(error)).toBe(true);
    expect(error.status).toBe(404);
    expect(error.kind).toBe('path');
  });

  it('resolves on 200', async () => {
    downloadAsync.mockResolvedValue({ status: 200 });

    await expect(
      webdavBackend.download('veloq-old.veloqdb', '/cache/out')
    ).resolves.toBeUndefined();
  });
});

describe('webdavBackend.delete', () => {
  it('logs a rejected delete instead of failing the caller', async () => {
    routeFetch({ DELETE: () => response(403) });

    await expect(webdavBackend.delete('veloq-old.veloqdb')).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledTimes(2);
    expect(String(mockWarn.mock.calls[0][0])).toContain('403');
  });

  it('stays quiet when the file was already gone', async () => {
    routeFetch({ DELETE: () => response(404) });

    await webdavBackend.delete('veloq-old.veloqdb');

    expect(mockWarn).not.toHaveBeenCalled();
  });
});
