/**
 * Scenario: the athlete taps Export Backup while another write holds the
 * backup slot for longer than the foreground ceiling.
 *
 * Expected behaviour: at the ceiling the row stops waiting and reports that
 * the export is still running, without an error. When the write ends the
 * archive is offered to the share sheet once, on the screen that is still
 * mounted or on the next mount.
 */
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useExportRecordBackup } from '@/features/settings/hooks/useBackup';
import { inBackupSlot } from '@/features/settings/lib/backupSlot';
import { FOREGROUND_BACKUP_TIMEOUT_MS } from '@/features/settings/lib/backup';
import { shareExistingFile } from '@/features/settings/lib/shareFile';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const mockRunRecordBackup = jest.fn<Promise<void>, [string]>();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ runRecordBackup: (path: string) => mockRunRecordBackup(path) }),
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
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
}));

let releaseHolder: () => void = () => {};

function holdSlot(): Promise<void> {
  return inBackupSlot(
    () =>
      new Promise<void>((resolve) => {
        releaseHolder = resolve;
      })
  );
}

async function pastCeiling() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(FOREGROUND_BACKUP_TIMEOUT_MS + 2_000);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRunRecordBackup.mockReset().mockResolvedValue(undefined);
  (shareExistingFile as jest.Mock).mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('reports still running at the ceiling and shares once the slot holder ends', async () => {
  const holder = holdSlot();
  const { result } = renderHook(() => useExportRecordBackup());

  await act(async () => {
    void result.current.exportRecordBackup();
  });
  await pastCeiling();

  expect(Alert.alert).not.toHaveBeenCalled();
  expect(result.current.exporting).toBe(false);
  expect(result.current.stillRunning).toBe(true);
  expect(shareExistingFile).not.toHaveBeenCalled();

  await act(async () => {
    releaseHolder();
    await holder;
    await jest.advanceTimersByTimeAsync(1_000);
  });

  expect(Alert.alert).not.toHaveBeenCalled();
  expect(shareExistingFile).toHaveBeenCalledTimes(1);
  expect(shareExistingFile).toHaveBeenCalledWith(
    expect.stringMatching(/\.zip$/),
    'application/zip'
  );
  expect(result.current.stillRunning).toBe(false);
});

it('offers the archive on the next mount when the screen was left', async () => {
  const holder = holdSlot();
  const first = renderHook(() => useExportRecordBackup());
  await act(async () => {
    void first.result.current.exportRecordBackup();
  });
  await pastCeiling();
  first.unmount();

  await act(async () => {
    releaseHolder();
    await holder;
    await jest.advanceTimersByTimeAsync(1_000);
  });
  expect(shareExistingFile).not.toHaveBeenCalled();

  const second = renderHook(() => useExportRecordBackup());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1_000);
  });

  expect(shareExistingFile).toHaveBeenCalledTimes(1);
  expect(second.result.current.stillRunning).toBe(false);
});

it('alerts when the lapsed write fails', async () => {
  const holder = holdSlot();
  mockRunRecordBackup.mockRejectedValue(new Error('disk full'));
  const { result } = renderHook(() => useExportRecordBackup());
  await act(async () => {
    void result.current.exportRecordBackup();
  });
  await pastCeiling();

  await act(async () => {
    releaseHolder();
    await holder;
    await jest.advanceTimersByTimeAsync(1_000);
  });

  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(shareExistingFile).not.toHaveBeenCalled();
  expect(result.current.stillRunning).toBe(false);
});

it('does not offer the archive a second time when the share sheet stays open past the ceiling', async () => {
  let closeSheet: () => void = () => {};
  (shareExistingFile as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        closeSheet = resolve;
      })
  );
  const { result } = renderHook(() => useExportRecordBackup());
  await act(async () => {
    void result.current.exportRecordBackup();
    await jest.advanceTimersByTimeAsync(1_000);
  });
  await pastCeiling();
  await act(async () => {
    closeSheet();
    await jest.advanceTimersByTimeAsync(1_000);
  });

  expect(shareExistingFile).toHaveBeenCalledTimes(1);
  expect(result.current.stillRunning).toBe(false);
  expect(Alert.alert).not.toHaveBeenCalled();
});
