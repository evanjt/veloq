/**
 * Scenario: an athlete signs in to an empty library on a phone with no device
 * backup, or whose device-backup record zip the engine refused. Their backups
 * may be in a file or on a WebDAV server, and nothing else tells them so.
 *
 * Expected behaviour: the first signed-in launch on an empty library offers a
 * restore once, and only when a backup was found, which on iPhone includes
 * Veloq's own iCloud Drive folder after a reinstall. With none found nothing
 * opens. A library that holds
 * activities, a record already applied or answered, and a prompt that was
 * dismissed are never offered it again.
 */

import { Platform } from 'react-native';

import {
  answerRestorePrompt,
  findNewestBackup,
  restorePromptDue,
} from '@/features/settings/lib/restorePrompt';

const mockSettings = new Map<string, string>();
const mockIcloudList = jest.fn(async (): Promise<unknown[]> => []);

jest.mock('@/shared/storage/platformRecord', () => ({ platformRecordUri: () => null }));
jest.mock('@/features/settings/lib/autobackup/webdavConfig', () => ({
  initWebdavConfig: async () => {},
  getWebdavConfig: () => null,
}));
jest.mock('@/features/settings/lib/autobackup/backends', () => {
  const { Platform: platform } = jest.requireActual('react-native');
  return {
    webdavBackend: { listBackups: async () => [] },
    googleDriveBackend: { isAvailable: async () => false, listBackups: async () => [] },
    icloudBackend: { listBackups: () => mockIcloudList() },
    isIcloudSupported: () => platform.OS === 'ios',
  };
});

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key) ?? null,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
  }),
}));

const os = Platform.OS;

beforeEach(() => {
  mockSettings.clear();
  mockIcloudList.mockReset();
  mockIcloudList.mockResolvedValue([]);
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
});

describe('the restore prompt on an empty library', () => {
  it('is due when the library is empty, a backup was found and nothing has answered it', () => {
    expect(restorePromptDue(0, true)).toBe(true);
  });

  it('is not due on a first launch where no backup was found', () => {
    expect(restorePromptDue(0, false)).toBe(false);
  });

  it('is not due on a library that holds activities', () => {
    expect(restorePromptDue(1, true)).toBe(false);
  });

  it('is not due once a platform record was applied or this library wrote one', () => {
    mockSettings.set('__platform_record_answered', '1');
    expect(restorePromptDue(0, true)).toBe(false);
  });

  it('never returns once it is dismissed', () => {
    expect(restorePromptDue(0, true)).toBe(true);
    answerRestorePrompt();
    expect(restorePromptDue(0, true)).toBe(false);
    expect(restorePromptDue(0, true)).toBe(false);
  });
});

describe('a backup found after a reinstall on iPhone', () => {
  const zip = { id: 'veloq-2026-06-10T08-00-00-000Z.zip', timestamp: '2026-06-10T08:00:00.000Z' };

  it('is found in Veloq’s iCloud Drive folder with nothing set up', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    mockIcloudList.mockResolvedValue([zip]);
    await expect(findNewestBackup()).resolves.toMatchObject({ source: 'icloud', entry: zip });
  });

  it('is not found in an empty folder, or when iCloud cannot be reached', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    await expect(findNewestBackup()).resolves.toBeNull();
    mockIcloudList.mockRejectedValue(new Error('iCloud is not available'));
    await expect(findNewestBackup()).resolves.toBeNull();
  });

  it('is never looked for on Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    mockIcloudList.mockResolvedValue([zip]);
    await expect(findNewestBackup()).resolves.toBeNull();
    expect(mockIcloudList).not.toHaveBeenCalled();
  });
});
