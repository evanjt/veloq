/**
 * Scenario: on Android the athlete signs in to Google from the backup screen, and automatic
 * backup copies the record zip into Veloq's own hidden app data folder in their Google Drive.
 *
 * Expected behaviour: a run creates one file in that folder, reads it back and stamps the
 * destination. The restore lists find it. A sign-in that has lapsed is a failure the athlete is
 * shown, and the copy stays owed until they sign in again. Forgetting the carriers revokes the
 * grant and forgets the account, and never deletes a file. On iOS the carrier does not exist.
 */

import { Platform } from 'react-native';

import {
  forgetBackupCarrier,
  getBackupFailures,
  getDestinationLastBackup,
  onBackupCarrierSignedIn,
  onBackupReconnect,
  performBackup,
} from '@/features/settings/lib/autobackup';
import { failureMessageKey } from '@/features/settings/lib/autobackup/backends/errors';
import {
  getGoogleDriveAccount,
  googleDriveBackend,
  signInToGoogleDrive,
} from '@/features/settings/lib/autobackup/backends/googleDriveBackend';

const MOCK_ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]);
const ACCOUNT = 'rider@example.org';

const mockSettings = new Map<string, string>();
const mockSecure = new Map<string, string>();
/** Every file on the device by uri, the record zip among them. */
const mockFiles = new Map<string, Uint8Array>();

interface DriveFile {
  name: string;
  parents: string[];
  createdTime: string;
  bytes: Uint8Array;
}

/**
 * A stub of Drive's REST surface for one account. Only a request carrying the token the native
 * side last handed out is let in, as Drive does once a token is revoked or has lapsed.
 */
const mockDrive = {
  files: new Map<string, DriveFile>(),
  nextId: 1,
  token: 'token-1',
  /** A status the next create answers with instead of creating, when set. */
  refuseCreate: null as null | { status: number; body: string },
  /** Whether the content upload keeps only part of the bytes. */
  truncates: false,
  revoked: [] as string[],
  deletes: [] as string[],
  requests: [] as string[],
};

/** What the native module answers, by method. */
const mockNative = {
  consented: true,
  authorizeGoogleDrive: jest.fn(async (interactive: boolean) => {
    if (!mockNative.consented && !interactive) {
      throw Object.assign(new Error('consent needed'), { code: 'ERR_GOOGLE_SIGN_IN_NEEDED' });
    }
    mockNative.consented = true;
    return mockDrive.token;
  }),
  clearGoogleDriveToken: jest.fn(async (_token: string) => {}),
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    deleteSetting: (key: string) => mockSettings.delete(key),
    engineInstall: () => 1,
    runRecordBackup: async (path: string) => {
      mockFiles.set(`file://${path}`, MOCK_ZIP_BYTES);
    },
  }),
}));

/** A carrier the athlete has not set up, standing in for the other two. */
function mockUnsetCarrier(id: string) {
  return {
    id,
    name: id,
    isRemote: false,
    isAvailable: async () => false,
    listBackups: async () => [],
    upload: async () => '',
    download: async () => {},
    delete: async () => {},
  };
}

jest.mock('@/features/settings/lib/autobackup/backends/folderBackend', () => ({
  folderBackend: mockUnsetCarrier('folder'),
  forgetBackupFolder: () => {},
  pickBackupFolder: async () => null,
  getBackupFolderName: () => null,
}));

jest.mock('@/features/settings/lib/autobackup/backends/webdavBackend', () => ({
  webdavBackend: mockUnsetCarrier('webdav'),
  testWebdavConnection: async () => ({ kind: 'ok' }),
}));

jest.mock('expo-secure-store', () => ({
  ...jest.requireActual('expo-secure-store'),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 3,
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockSecure.delete(key);
  },
}));

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: (name: string) =>
    name === 'VeloqBackupExclusion' ? mockNative : null,
}));

jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
}));

/** Answer one request the way Drive would. */
function mockDriveAnswer(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: Uint8Array | string
): { status: number; body: string | Uint8Array } {
  const at = new URL(url);
  mockDrive.requests.push(`${method} ${at.pathname}`);
  if (at.host === 'oauth2.googleapis.com' && at.pathname === '/revoke') {
    mockDrive.revoked.push(String(body).replace(/^token=/, ''));
    return { status: 200, body: '' };
  }
  if (headers.Authorization !== `Bearer ${mockDrive.token}`) {
    return { status: 401, body: '{"error":{"code":401,"message":"Invalid Credentials"}}' };
  }
  const json = (status: number, value: unknown) => ({ status, body: JSON.stringify(value) });
  const path = at.pathname;
  if (method === 'GET' && path === '/drive/v3/about') {
    return json(200, { user: { emailAddress: ACCOUNT } });
  }
  if (method === 'GET' && path === '/drive/v3/files') {
    if (at.searchParams.get('spaces') !== 'appDataFolder') return json(200, { files: [] });
    const nameQuery = /name\s*=\s*'([^']+)'/.exec(at.searchParams.get('q') ?? '')?.[1];
    const files = [...mockDrive.files.entries()]
      .filter(([, f]) => f.parents.includes('appDataFolder'))
      .filter(([, f]) => !nameQuery || f.name === nameQuery)
      .sort(([, a], [, b]) => b.createdTime.localeCompare(a.createdTime))
      .map(([id, f]) => ({
        id,
        name: f.name,
        createdTime: f.createdTime,
        size: String(f.bytes.length),
      }));
    return json(200, { files });
  }
  if (method === 'POST' && path === '/drive/v3/files') {
    if (mockDrive.refuseCreate) return mockDrive.refuseCreate;
    const meta = JSON.parse(String(body)) as { name: string; parents?: string[] };
    const id = `drive-${mockDrive.nextId++}`;
    mockDrive.files.set(id, {
      name: meta.name,
      parents: meta.parents ?? ['root'],
      createdTime: new Date(Date.now() + mockDrive.nextId).toISOString(),
      bytes: new Uint8Array(),
    });
    return json(200, { id, name: meta.name });
  }
  const content = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
  if (method === 'PATCH' && content && at.searchParams.get('uploadType') === 'media') {
    const file = mockDrive.files.get(content[1]);
    if (!file) return json(404, { error: { code: 404 } });
    const bytes = body as Uint8Array;
    file.bytes = mockDrive.truncates ? bytes.slice(0, bytes.length - 2) : bytes;
    return json(200, { id: content[1] });
  }
  const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
  if (one && method === 'GET' && at.searchParams.get('alt') === 'media') {
    const file = mockDrive.files.get(one[1]);
    return file ? { status: 200, body: file.bytes } : json(404, { error: { code: 404 } });
  }
  if (one && method === 'DELETE') {
    mockDrive.deletes.push(one[1]);
    mockDrive.files.delete(one[1]);
    return { status: 204, body: '' };
  }
  return json(400, { error: { code: 400, message: `unexpected ${method} ${path}` } });
}

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  makeDirectoryAsync: async () => undefined,
  deleteAsync: async (uri: string) => {
    mockFiles.delete(uri);
  },
  getInfoAsync: async (uri: string) => {
    const bytes = mockFiles.get(uri);
    return bytes ? { exists: true, size: bytes.length } : { exists: false };
  },
  uploadAsync: async (
    url: string,
    from: string,
    options: { httpMethod?: string; headers?: Record<string, string> }
  ) => {
    const bytes = mockFiles.get(from);
    if (!bytes) throw new Error(`missing ${from}`);
    const answer = mockDriveAnswer(options.httpMethod ?? 'POST', url, options.headers ?? {}, bytes);
    return { status: answer.status, body: String(answer.body), headers: {} };
  },
  downloadAsync: async (url: string, to: string, options: { headers?: Record<string, string> }) => {
    const answer = mockDriveAnswer('GET', url, options.headers ?? {});
    if (answer.status === 200) mockFiles.set(to, answer.body as Uint8Array);
    return { status: answer.status, uri: to, headers: {} };
  },
}));

// This suite answers no native module but its own, and expo-crypto needs one at
// import, so the copy a run fetches back is hashed here from the files above.
jest.mock('@/features/settings/lib/autobackup/zipFingerprint', () => ({
  zipFingerprint: async (uri: string) => {
    const bytes = mockFiles.get(uri);
    if (!bytes) throw new Error(`missing ${uri}`);
    const sha256 = jest
      .requireActual<typeof import('crypto')>('crypto')
      .createHash('sha256')
      .update(bytes)
      .digest('hex');
    return { sha256, size: bytes.length };
  },
}));

const realFetch = global.fetch;
const os = Platform.OS;

function onPlatform(platform: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
}

/** Let work a call started without awaiting run to its end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function driveFiles(): DriveFile[] {
  return [...mockDrive.files.values()];
}

beforeEach(async () => {
  mockSettings.clear();
  mockSecure.clear();
  mockFiles.clear();
  mockDrive.files.clear();
  mockDrive.nextId = 1;
  mockDrive.token = 'token-1';
  mockDrive.refuseCreate = null;
  mockDrive.truncates = false;
  mockDrive.revoked = [];
  mockDrive.deletes = [];
  mockDrive.requests = [];
  mockNative.consented = true;
  mockNative.authorizeGoogleDrive.mockClear();
  mockNative.clearGoogleDriveToken.mockClear();
  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const answer = mockDriveAnswer(
      (init.method ?? 'GET').toUpperCase(),
      url,
      (init.headers ?? {}) as Record<string, string>,
      init.body as string | undefined
    );
    const text = typeof answer.body === 'string' ? answer.body : '';
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      text: async () => text,
      json: async () => JSON.parse(text),
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(async () => {
  global.fetch = realFetch;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  // Leave no account cached for the next case.
  forgetBackupCarrier();
  await settle();
});

describe('on Android, signed in to Google Drive', () => {
  beforeEach(async () => {
    onPlatform('android');
    await expect(signInToGoogleDrive()).resolves.toBe(ACCOUNT);
  });

  it('holds the account the sign-in chose, for the row label', () => {
    expect(getGoogleDriveAccount()).toBe(ACCOUNT);
    expect(mockNative.authorizeGoogleDrive).toHaveBeenCalledWith(true);
  });

  it('creates one zip in the app data folder from a run, reads it back and stamps it', async () => {
    const result = await performBackup(true);

    expect(result.carriers.googleDrive).toEqual({ status: 'written' });
    const files = driveFiles();
    expect(files).toHaveLength(1);
    expect(files[0].parents).toEqual(['appDataFolder']);
    expect(files[0].name).toMatch(/^veloq-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.zip$/);
    expect(files[0].bytes).toEqual(MOCK_ZIP_BYTES);
    expect(mockDrive.requests).toContain(`GET /drive/v3/files/${[...mockDrive.files.keys()][0]}`);
    expect(getDestinationLastBackup('googleDrive')).not.toBeNull();
    expect(getBackupFailures()).toEqual({});
  });

  it('reports a copy that did not read back the same as unverified and owes it', async () => {
    mockDrive.truncates = true;

    const result = await performBackup(true);

    expect(result.carriers.googleDrive).toEqual({ status: 'failed', kind: 'unverified' });
    expect(getDestinationLastBackup('googleDrive')).toBeNull();
    expect(JSON.parse(mockSettings.get('__backup_owed_carriers') ?? '[]')).toEqual(['googleDrive']);
  });

  it('lists the zips runs wrote, newest first, and restores one by its listed id', async () => {
    await performBackup(true);
    jest.setSystemTime(Date.now() + 1000);
    await performBackup(true);

    const entries = await googleDriveBackend.listBackups();

    expect(entries).toHaveLength(2);
    expect(new Date(entries[0].timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(entries[1].timestamp).getTime()
    );
    expect(entries[0].id).toMatch(/\.zip$/);
    expect(entries[0].sizeBytes).toBe(MOCK_ZIP_BYTES.length);

    await googleDriveBackend.download(entries[1].id, 'file:///cache/restore.zip');
    expect(mockFiles.get('file:///cache/restore.zip')).toEqual(MOCK_ZIP_BYTES);
  });

  it('records a lapsed sign-in as the sign-in kind and keeps the copy owed', async () => {
    mockDrive.token = 'token-2';
    mockNative.authorizeGoogleDrive.mockImplementationOnce(async () => 'token-1');

    const result = await performBackup(true);

    expect(result.carriers.googleDrive).toEqual({ status: 'failed', kind: 'signin' });
    expect(getBackupFailures().googleDrive?.kind).toBe('signin');
    expect(failureMessageKey('signin')).toBe('backup.backupFailedSignIn');
    expect(JSON.parse(mockSettings.get('__backup_owed_carriers') ?? '[]')).toEqual(['googleDrive']);
    expect(driveFiles()).toHaveLength(0);
  });

  it('asks for no consent screen during a run, and fails it for a sign-in instead', async () => {
    mockNative.consented = false;

    const result = await performBackup(true);

    expect(result.carriers.googleDrive).toEqual({ status: 'failed', kind: 'signin' });
    expect(mockNative.authorizeGoogleDrive).toHaveBeenLastCalledWith(false);
  });

  it('still sends a copy owed for a passing reason when an older failure of another kind stands', async () => {
    mockSettings.set(
      '__last_backup_failure',
      JSON.stringify({ googleDrive: { kind: 'quota', status: 403, at: 1 } })
    );
    mockSettings.set('__backup_owed_carriers', JSON.stringify(['googleDrive']));

    onBackupReconnect();
    await settle();

    expect(driveFiles()).toHaveLength(1);
    expect(getBackupFailures().googleDrive).toBeUndefined();
  });

  it('waits for the athlete rather than retrying a lapsed sign-in on reconnect', async () => {
    mockNative.consented = false;
    await performBackup(true);
    mockNative.authorizeGoogleDrive.mockClear();

    onBackupReconnect();
    await settle();

    expect(mockNative.authorizeGoogleDrive).not.toHaveBeenCalled();
    expect(driveFiles()).toHaveLength(0);
  });

  it('sends the owed copy once the athlete signs in again, and clears the failure', async () => {
    mockNative.consented = false;
    await performBackup(true);

    await signInToGoogleDrive();
    await onBackupCarrierSignedIn('googleDrive');

    expect(driveFiles()).toHaveLength(1);
    expect(getBackupFailures().googleDrive).toBeUndefined();
    expect(mockSettings.get('__backup_owed_carriers') ?? '').toBe('');
  });

  it('maps a full Drive to the quota kind', async () => {
    mockDrive.refuseCreate = {
      status: 403,
      body: JSON.stringify({
        error: { code: 403, errors: [{ reason: 'storageQuotaExceeded' }] },
      }),
    };

    const result = await performBackup(true);

    expect(result.carriers.googleDrive).toEqual({ status: 'failed', kind: 'quota' });
    expect(getBackupFailures().googleDrive?.kind).toBe('quota');
  });

  it('forgets the account and revokes the grant with the carriers, and deletes no file', async () => {
    await performBackup(true);

    forgetBackupCarrier();
    await settle();

    expect(getGoogleDriveAccount()).toBeNull();
    expect(await googleDriveBackend.isAvailable()).toBe(false);
    expect(mockDrive.revoked).toEqual(['token-1']);
    expect(mockNative.clearGoogleDriveToken).toHaveBeenCalledWith('token-1');
    expect(mockDrive.deletes).toEqual([]);
    expect(driveFiles()).toHaveLength(1);
  });

  it('keeps the account held when the picker is dismissed', async () => {
    mockNative.authorizeGoogleDrive.mockImplementationOnce(async () => {
      throw Object.assign(new Error('cancelled'), { code: 'ERR_GOOGLE_SIGN_IN_CANCELLED' });
    });

    await expect(signInToGoogleDrive()).resolves.toBeNull();
    expect(getGoogleDriveAccount()).toBe(ACCOUNT);
  });
});

describe('on Android, never signed in', () => {
  beforeEach(() => onPlatform('android'));

  it('is off by default, and a run skips it', async () => {
    expect(await googleDriveBackend.isAvailable()).toBe(false);
    const result = await performBackup(true);
    expect(result.carriers.googleDrive).toEqual({ status: 'skipped', reason: 'unavailable' });
    expect(mockNative.authorizeGoogleDrive).not.toHaveBeenCalled();
  });
});

describe('on iOS', () => {
  beforeEach(() => onPlatform('ios'));

  it('has no Google Drive carrier, even with an account held from elsewhere', async () => {
    mockSecure.set('veloq-google-drive-account', ACCOUNT);
    expect(await googleDriveBackend.isAvailable()).toBe(false);
    await expect(signInToGoogleDrive()).rejects.toThrow();
    expect(mockNative.authorizeGoogleDrive).not.toHaveBeenCalled();
  });
});
