/**
 * Scenario: a phone set up from a device backup gets the record zip back in the
 * documents directory and no library, and the athlete signs in.
 *
 * Expected behaviour: the launch applies nothing from the zip. It offers it on
 * the feed with the time the record names, and only Restore on that offer
 * restores it, once. Dismissing answers the offer without restoring, and no
 * later launch offers it again. A library that holds activities, or a zip the
 * engine would refuse, is offered nothing.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { runLaunchRestores } from '@/features/settings/lib/launchRestore';
import { answerRestorePrompt, restoreFoundBackup } from '@/features/settings/lib/restorePrompt';
import { restoreRecordBackup } from '@/features/settings/lib/backup';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';

const ZIP = 'file:///docs/veloq-decisions.zip';
const WRITTEN_AT = '2026-06-01T08:30:00.000Z';
const MARKER = '__platform_record_answered';

const mockSettings = new Map<string, string>();
const mockCheckRecordBackup = jest.fn(async (_uri: string): Promise<string | null> => WRITTEN_AT);

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key) ?? null,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
  }),
}));
jest.mock('@/shared/storage/platformRecord', () => ({
  platformRecordUri: () => 'file:///docs/veloq-decisions.zip',
}));
jest.mock('@/features/settings/lib/backup', () => ({
  checkRecordBackup: (uri: string) => mockCheckRecordBackup(uri),
  restoreRecordBackup: jest.fn(async () => ({ placed: 3, unplaced: 0, missingActivityIds: [] })),
}));
jest.mock('@/features/settings/lib/heldImport', () => ({
  applyHeldImport: jest.fn(async () => false),
}));
jest.mock('@/features/settings/lib/openedBackup', () => ({
  applyOpenedBackup: jest.fn(async () => false),
}));
jest.mock('@/features/settings/lib/autobackup/webdavConfig', () => ({
  initWebdavConfig: async () => {},
  getWebdavConfig: () => null,
}));
jest.mock('@/features/settings/lib/autobackup/backends', () => ({
  webdavBackend: { id: 'webdav', listBackups: async () => [] },
  googleDriveBackend: {
    id: 'google-drive',
    isAvailable: async () => false,
    listBackups: async () => [],
  },
  icloudBackend: { id: 'icloud', listBackups: async () => [] },
  isIcloudSupported: () => false,
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 4096, modificationTime: 0 })),
}));

const t = ((key: string) => key) as never;
const restore = restoreRecordBackup as jest.MockedFunction<typeof restoreRecordBackup>;
const getInfoAsync = FileSystem.getInfoAsync as jest.MockedFunction<typeof FileSystem.getInfoAsync>;
const offer = () => useWhatsNewStore.getState().restoreOffer;

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.clear();
  mockCheckRecordBackup.mockReset().mockResolvedValue(WRITTEN_AT);
  getInfoAsync.mockResolvedValue({ exists: true, size: 4096, modificationTime: 0 } as never);
  useWhatsNewStore.getState().setRestoreOffer(null);
});

describe('the record zip a device backup brings back, on a signed-in launch', () => {
  it('is offered with the time the record names and not restored', async () => {
    await runLaunchRestores(0, t, () => true);

    expect(restore).not.toHaveBeenCalled();
    expect(mockSettings.get(MARKER)).toBeUndefined();
    expect(offer()).toEqual(
      expect.objectContaining({
        source: 'device',
        backend: null,
        entry: expect.objectContaining({ id: ZIP, timestamp: WRITTEN_AT }),
      })
    );
  });

  it('is restored once, from its own uri, on Restore', async () => {
    await runLaunchRestores(0, t, () => true);
    const found = offer();
    expect(found).not.toBeNull();

    await restoreFoundBackup(found!);
    answerRestorePrompt();

    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith(ZIP);
    expect(offer()).toBeNull();
    expect(mockSettings.get(MARKER)).toBe('1');
  });

  it('is not restored on Dismiss, and no later launch offers it', async () => {
    await runLaunchRestores(0, t, () => true);
    answerRestorePrompt();

    expect(restore).not.toHaveBeenCalled();
    expect(mockSettings.get(MARKER)).toBe('1');

    await runLaunchRestores(0, t, () => true);
    expect(offer()).toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });

  it('is not offered on a library that holds activities', async () => {
    await runLaunchRestores(12, t, () => true);

    expect(offer()).toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });

  it('is not offered when the engine would refuse it, and the offer stays unanswered', async () => {
    mockCheckRecordBackup.mockRejectedValue(new Error('Record belongs to another athlete'));
    await runLaunchRestores(0, t, () => true);

    expect(offer()).toBeNull();
    expect(restore).not.toHaveBeenCalled();
    expect(mockSettings.get(MARKER)).toBeUndefined();
  });

  it('is not offered when there is no zip', async () => {
    getInfoAsync.mockResolvedValue({ exists: false } as never);
    await runLaunchRestores(0, t, () => true);

    expect(offer()).toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });

  it('is not offered on a launch superseded while it looked', async () => {
    await runLaunchRestores(0, t, () => false);

    expect(offer()).toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });
});
