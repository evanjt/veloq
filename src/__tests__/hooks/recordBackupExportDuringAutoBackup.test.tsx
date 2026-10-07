/**
 * Scenario: the auto-backup is writing its record archive when the athlete
 * taps Export Backup. Rust holds one backup slot for both and refuses a second
 * claim with `Busy`.
 *
 * Expected behaviour: the export waits for the auto-backup to end, then writes
 * and shares its own archive. No error is shown for a backup that is working.
 */
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useExportRecordBackup } from '@/features/settings/hooks/useBackup';
import { performBackup, type BackupBackend } from '@/features/settings/lib/autobackup';
import { shareExistingFile } from '@/features/settings/lib/shareFile';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const mockSettings = new Map<string, string>();
const mockRunRecordBackup = jest.fn<Promise<void>, [string]>();
let mockSlotHeld = false;
let mockReleaseFirst: (() => void) | null = null;

/** Rust's slot: the first claim holds until released, a claim while held is refused. */
function mockClaimSlot(path: string): Promise<void> {
  mockRunRecordBackup(path);
  if (mockSlotHeld) {
    return Promise.reject({ tag: 'Busy', inner: { msg: 'A backup is already running' } });
  }
  mockSlotHeld = true;
  if (mockRunRecordBackup.mock.calls.length > 1) {
    mockSlotHeld = false;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    mockReleaseFirst = () => {
      mockSlotHeld = false;
      resolve();
    };
  });
}

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    engineInstall: () => 1,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    runRecordBackup: (path: string) => mockClaimSlot(path),
    getBackupMetadata: () => ({ schema_version: '14', activity_count: '1', athlete_id: 'i1' }),
  }),
  getNativeModule: () => null,
  isEngineReady: () => true,
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

const testBackend: BackupBackend = {
  id: 'test-export-during-auto',
  name: 'Test Export During Auto',
  isRemote: false,
  isAvailable: async () => true,
  listBackups: async () => [],
  upload: async () => {},
  download: async () => {},
  delete: async () => {},
};

const mockCarriers: BackupBackend[] = [testBackend];
jest.mock('@/features/settings/lib/autobackup/backends/carriers', () => ({
  get backupCarriers() {
    return mockCarriers;
  },
}));

async function untilClaimed(nth: number) {
  for (let i = 0; i < 300 && mockRunRecordBackup.mock.calls.length < nth; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (mockRunRecordBackup.mock.calls.length < nth) throw new Error(`claim ${nth} never made`);
}

beforeEach(() => {
  mockSettings.clear();
  mockSettings.set('__auto_backup_enabled', '1');
  mockRunRecordBackup.mockClear();
  mockSlotHeld = false;
  mockReleaseFirst = null;
  (shareExistingFile as jest.Mock).mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('waits for a running auto-backup and then shares its own archive', async () => {
  const auto = performBackup(true);
  await untilClaimed(1);

  const { result } = renderHook(() => useExportRecordBackup());
  let exporting: Promise<void> = Promise.resolve();
  await act(async () => {
    exporting = result.current.exportRecordBackup();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  expect(Alert.alert).not.toHaveBeenCalled();
  expect(shareExistingFile).not.toHaveBeenCalled();
  expect(result.current.exporting).toBe(true);

  await act(async () => {
    mockReleaseFirst?.();
    await auto;
    await exporting;
  });

  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockRunRecordBackup).toHaveBeenCalledTimes(2);
  expect(shareExistingFile).toHaveBeenCalledTimes(1);
  expect(shareExistingFile).toHaveBeenCalledWith(
    expect.stringMatching(/\.zip$/),
    'application/zip'
  );
  expect(result.current.exporting).toBe(false);
});

it('exports at once once the auto-backup has ended', async () => {
  const auto = performBackup(true);
  await untilClaimed(1);
  mockReleaseFirst?.();
  await auto;

  const { result } = renderHook(() => useExportRecordBackup());
  await act(async () => {
    await result.current.exportRecordBackup();
  });

  expect(Alert.alert).not.toHaveBeenCalled();
  expect(shareExistingFile).toHaveBeenCalledTimes(1);
});
