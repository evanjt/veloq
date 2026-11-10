/**
 * Scenario: Clear Data deletes the WebDAV keychain entries, and one delete throws
 * (a locked keychain). The wipe logs the failure and carries on, so the in-memory
 * config has to be gone already. Otherwise the next athlete's auto-backup sends
 * to the previous athlete's server with the previous password.
 *
 * Expected behaviour: the cache is cleared whether or not a delete succeeds, and
 * every other delete is allowed to settle before the clear reports the failure.
 */
import * as SecureStore from 'expo-secure-store';
import {
  clearWebdavConfig,
  getWebdavConfig,
  setWebdavConfig,
} from '@/features/settings/lib/autobackup/webdavConfig';

const URL_KEY = 'veloq-webdav-url';
const USERNAME_KEY = 'veloq-webdav-username';
const PASSWORD_KEY = 'veloq-webdav-password';
const PLAIN_LAN_KEY = 'veloq-webdav-plain-lan';

jest.mock('expo-secure-store', () => ({
  ...jest.requireActual('expo-secure-store'),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 3,
}));

const deleteItem = jest.mocked(SecureStore.deleteItemAsync);

beforeEach(() => {
  deleteItem.mockImplementation(async () => {});
});

afterEach(async () => {
  deleteItem.mockImplementation(async () => {});
  await clearWebdavConfig();
});

it('forgets the config even when a keychain delete rejects', async () => {
  await setWebdavConfig('https://cloud.example.com/dav/', 'previous-athlete', 'previous-secret');
  deleteItem.mockImplementation(async (key) => {
    if (key === PASSWORD_KEY) throw new Error('keychain locked');
  });

  await expect(clearWebdavConfig()).rejects.toThrow('keychain locked');

  expect(getWebdavConfig()).toBeNull();
});

it('lets every other delete settle before it reports the failure', async () => {
  await setWebdavConfig('https://cloud.example.com/dav/', 'previous-athlete', 'previous-secret');
  const settled: string[] = [];
  deleteItem.mockImplementation(async (key) => {
    if (key === URL_KEY) throw new Error('keychain locked');
    await new Promise((resolve) => setTimeout(resolve, 10));
    settled.push(key);
  });

  await expect(clearWebdavConfig()).rejects.toThrow('keychain locked');

  expect([...settled].sort()).toEqual([USERNAME_KEY, PASSWORD_KEY, PLAIN_LAN_KEY].sort());
});
