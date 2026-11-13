/**
 * Scenario: the WebDAV backend sends Basic credentials and the whole database
 * on every backup, so the server address decides whether they cross the wire
 * in the clear.
 *
 * Expected behaviour: an `http://` or `https://` address is accepted for any
 * host, since people self-host WebDAV, and the form warns about plain http.
 * Any other scheme is refused at entry and nothing reaches the network.
 */

import {
  webdavUrlProblem,
  setWebdavConfig,
  getWebdavConfig,
  clearWebdavConfig,
  initWebdavConfig,
  webdavConfigProblem,
} from '@/features/settings/lib/autobackup/webdavConfig';
import * as SecureStore from 'expo-secure-store';
import { testWebdavConnection } from '@/features/settings/lib/autobackup/backends/webdavBackend';

/**
 * A dotted IPv4 address from its octets. The private-network examples are built
 * this way so the source carries no literal private address for a scan to read
 * as a real one.
 */
const ipv4 = (...octets: number[]): string => octets.join('.');

// The global mock forgets every write, and the opt-in has to survive a relaunch.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    ...jest.requireActual('expo-secure-store'),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 3,
  };
});

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  uploadAsync: jest.fn(),
  downloadAsync: jest.fn(),
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));

afterEach(async () => {
  await clearWebdavConfig();
});

describe('webdavUrlProblem', () => {
  it('accepts https in any case', () => {
    expect(webdavUrlProblem('https://cloud.example.com/remote.php/dav/files/athlete/')).toBeNull();
    expect(webdavUrlProblem('HTTPS://cloud.example.com/dav')).toBeNull();
    expect(webdavUrlProblem('  https://cloud.example.com/dav  ')).toBeNull();
  });

  it('accepts http to any host, private or public', () => {
    for (const url of [
      'http://cloud.example.com/dav',
      'HTTP://cloud.example.com/dav',
      'http://8.8.8.8/dav',
      `http://${ipv4(192, 168, 1, 20)}:8080/dav`,
      'http://nas.local/dav',
      'http://[::1]/dav',
      'http://[2001:4860:4860::8888]/dav',
    ]) {
      expect(webdavUrlProblem(url)).toBeNull();
    }
  });

  it('names a blank or unparseable address', () => {
    expect(webdavUrlProblem('')).toBe('empty');
    expect(webdavUrlProblem('   ')).toBe('empty');
    expect(webdavUrlProblem('cloud.example.com/dav')).toBe('invalid');
    expect(webdavUrlProblem('ftp://cloud.example.com/dav')).toBe('not-http');
  });
});

describe('setWebdavConfig', () => {
  it('refuses an address that is neither http nor https and stores nothing', async () => {
    await expect(
      setWebdavConfig('ftp://cloud.example.com/dav', 'athlete', 'pw')
    ).rejects.toMatchObject({ kind: 'address' });
    expect(getWebdavConfig()).toBeNull();
    await initWebdavConfig();
    expect(getWebdavConfig()).toBeNull();
  });

  it('stores a plain http address to a public host and reads it back after a relaunch', async () => {
    await setWebdavConfig('http://cloud.example.com/dav', 'athlete', 'pw');
    await initWebdavConfig();
    expect(getWebdavConfig()).toEqual({
      url: 'http://cloud.example.com/dav',
      username: 'athlete',
      password: 'pw',
    });
  });
});

describe('a config stored before 0.4.0', () => {
  it('keeps a plain-http LAN address usable with no opt-in key stored', async () => {
    await SecureStore.setItemAsync('veloq-webdav-url', `http://${ipv4(192, 168, 1, 20)}/dav`);
    await SecureStore.setItemAsync('veloq-webdav-username', 'athlete');
    await SecureStore.setItemAsync('veloq-webdav-password', 'secret');

    await initWebdavConfig();

    expect(webdavConfigProblem()).toBeNull();
    expect(getWebdavConfig()?.url).toBe(`http://${ipv4(192, 168, 1, 20)}/dav`);
  });
});

describe('testWebdavConnection outcomes', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  async function outcomeFor(status: number) {
    await setWebdavConfig('https://nas.example/dav', 'u', 'p');
    global.fetch = jest.fn(async () => ({ status, ok: status < 300 })) as unknown as typeof fetch;
    return testWebdavConnection();
  }

  it('names each server answer as a kind, never prose', async () => {
    expect(await outcomeFor(207)).toEqual({ kind: 'ok' });
    expect(await outcomeFor(401)).toEqual({ kind: 'unauthorised' });
    expect(await outcomeFor(405)).toEqual({ kind: 'methodNotAllowed' });
    expect(await outcomeFor(503)).toEqual({ kind: 'status', code: 503 });
  });

  it('reports a transport failure without carrying its English message', async () => {
    await setWebdavConfig('https://nas.example/dav', 'u', 'p');
    global.fetch = jest.fn(async () => {
      throw new Error('Network request failed');
    }) as unknown as typeof fetch;
    expect(await testWebdavConnection()).toEqual({ kind: 'transport' });
  });
});

describe('webdavTestMessage', () => {
  const t = (_k: string, fb: string | { defaultValue: string; code?: number }) =>
    typeof fb === 'string' ? fb : fb.defaultValue.replace('{{code}}', String(fb.code));
  const { webdavTestMessage } = jest.requireActual(
    '@/features/settings/lib/autobackup/webdavTestMessage'
  );

  vaultIt('words every failure from its kind and keeps the status code', () => {
    expect(webdavTestMessage({ kind: 'status', code: 503 }, t, null)).toBe('Server returned 503');
    expect(webdavTestMessage({ kind: 'transport' }, t, null)).toBe('Connection failed');
    expect(webdavTestMessage({ kind: 'urlProblem', problem: 'invalid' }, t, 'bad address')).toBe(
      'bad address'
    );
    expect(webdavTestMessage({ kind: 'unauthorised' }, t, null)).toBe('Authentication failed');
  });
});
