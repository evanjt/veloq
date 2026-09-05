/**
 * Scenario: the WebDAV backend sends Basic credentials and the whole database
 * on every backup, so the server address decides whether they cross the wire
 * in the clear.
 *
 * Expected behaviour: a plain `http://` address is refused at entry with the
 * reason, and accepted only for a private-network host behind an explicit
 * opt-in. Nothing reaches the network for a refused address.
 */

import * as FileSystem from 'expo-file-system/legacy';
import {
  webdavUrlProblem,
  setWebdavConfig,
  getWebdavConfig,
  clearWebdavConfig,
  initWebdavConfig,
} from '@/features/settings/lib/autobackup/webdavConfig';
import {
  webdavBackend,
  testWebdavConnection,
} from '@/features/settings/lib/autobackup/backends/webdavBackend';

// The global mock forgets every write, and the opt-in has to survive a relaunch.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
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
  uploadAsync: jest.fn(),
  downloadAsync: jest.fn(),
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));

const uploadAsync = FileSystem.uploadAsync as jest.Mock;

afterEach(async () => {
  await clearWebdavConfig();
});

describe('webdavUrlProblem', () => {
  it('accepts https in any case', () => {
    expect(webdavUrlProblem('https://cloud.example.com/remote.php/dav/files/evan/')).toBeNull();
    expect(webdavUrlProblem('HTTPS://cloud.example.com/dav')).toBeNull();
    expect(webdavUrlProblem('  https://cloud.example.com/dav  ')).toBeNull();
  });

  it('refuses http to a public host, opt-in or not', () => {
    expect(webdavUrlProblem('http://cloud.example.com/dav')).toBe('not-https');
    expect(webdavUrlProblem('http://cloud.example.com/dav', true)).toBe('not-https');
    expect(webdavUrlProblem('http://8.8.8.8/dav', true)).toBe('not-https');
  });

  it('refuses http to a private host without the opt-in', () => {
    expect(webdavUrlProblem('http://192.168.1.20:8080/dav')).toBe('not-https');
    expect(webdavUrlProblem('http://nas.local/dav')).toBe('not-https');
  });

  it('accepts http to a private host with the opt-in', () => {
    for (const url of [
      'http://192.168.1.20:8080/dav',
      'http://10.0.0.5/dav',
      'http://172.16.0.9/dav',
      'http://172.31.255.1/dav',
      'http://127.0.0.1/dav',
      'http://localhost:8080/dav',
      'http://nas.local/dav',
      'http://nas.lan/dav',
    ]) {
      expect(webdavUrlProblem(url, true)).toBeNull();
    }
    expect(webdavUrlProblem('http://172.32.0.1/dav', true)).toBe('not-https');
    expect(webdavUrlProblem('http://11.0.0.1/dav', true)).toBe('not-https');
  });

  it('names a blank or unparseable address', () => {
    expect(webdavUrlProblem('')).toBe('empty');
    expect(webdavUrlProblem('   ')).toBe('empty');
    expect(webdavUrlProblem('cloud.example.com/dav')).toBe('invalid');
    expect(webdavUrlProblem('ftp://cloud.example.com/dav')).toBe('not-https');
  });
});

describe('setWebdavConfig', () => {
  it('refuses a plain http address and stores nothing', async () => {
    await expect(setWebdavConfig('http://cloud.example.com/dav', 'evan', 'pw')).rejects.toThrow(
      /https/
    );
    expect(getWebdavConfig()).toBeNull();
    await initWebdavConfig();
    expect(getWebdavConfig()).toBeNull();
  });

  it('keeps a LAN opt-in with the address it was given for', async () => {
    await setWebdavConfig('http://192.168.1.20/dav', 'evan', 'pw', true);
    expect(getWebdavConfig()).toEqual({
      url: 'http://192.168.1.20/dav',
      username: 'evan',
      password: 'pw',
      plainLan: true,
    });
    await initWebdavConfig();
    expect(getWebdavConfig()?.plainLan).toBe(true);
  });

  it('refuses a LAN address without the opt-in', async () => {
    await expect(setWebdavConfig('http://192.168.1.20/dav', 'evan', 'pw')).rejects.toThrow(/https/);
    expect(getWebdavConfig()).toBeNull();
  });
});

describe('webdavBackend with a stored http address', () => {
  it('is unavailable and sends nothing', async () => {
    await setWebdavConfig('http://192.168.1.20/dav', 'evan', 'pw', true);
    (getWebdavConfig() as { plainLan: boolean }).plainLan = false;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await webdavBackend.isAvailable()).toBe(false);
    await expect(
      webdavBackend.upload('/tmp/routes.veloqdb', {
        timestamp: '2026-09-04T10:00:00.000Z',
        sizeBytes: 1,
        appVersion: '0.4.0',
        schemaVersion: 21,
        activityCount: 1,
        athleteId: 'i1',
      })
    ).rejects.toThrow(/https/);
    await expect(webdavBackend.listBackups()).rejects.toThrow(/https/);
    await expect(webdavBackend.download('x.veloqdb', '/tmp/x')).rejects.toThrow(/https/);
    await webdavBackend.delete('x.veloqdb');
    expect(await testWebdavConnection()).toMatch(/https/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadAsync).not.toHaveBeenCalled();
  });
});
