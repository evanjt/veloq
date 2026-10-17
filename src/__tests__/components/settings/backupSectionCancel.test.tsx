/**
 * Scenario: the athlete stops a bulk export or a Back Up Now while it runs.
 *
 * Expected behaviour: the running control is swapped for Cancel, the stop
 * names that run's own id, and a stopped run reads as cancelled rather than
 * failed.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { BackupSection } from '@/features/settings/components/BackupSection';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/useSyncStatus', () => ({ useSyncStatus: () => null }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('@/shared/native/useActivityCount', () => ({ useActivityCount: () => 402 }));

jest.mock('@/shared/native/useEngineSubscription', () => ({
  useEngineRead:
    () =>
    (
      read: (engine: {
        getUnplacedBackupRecords: () => unknown[];
        getBackupScreenData: () => unknown;
      }) => unknown
    ) =>
      read({ getUnplacedBackupRecords: () => [], getBackupScreenData: () => undefined }),
  useEngineSubscription: () => 0,
}));

jest.mock('@/features/settings/lib/autobackup', () => ({
  isAutoBackupEnabled: () => false,
  setAutoBackupEnabled: jest.fn(),
  getLastBackupTimestamp: () => null,
  getDestinationLastBackup: () => null,
  getUnplacedBackupRecords: async () => [],
  getBackupFailures: () => ({}),
  getBackupFolderName: () => null,
  pickBackupFolder: jest.fn(),
  forgetBackupFolder: jest.fn(),
  folderBackend: { id: 'folder', name: 'Folder' },
  failureMessageKey: () => 'backup.backupFailedMessage',
  performBackup: () => mockPerformBackup(),
  localBackend: { id: 'local', name: 'Local' },
  webdavBackend: { id: 'webdav', name: 'WebDAV' },
  getWebdavConfig: () => null,
  setWebdavConfig: jest.fn(),
  testWebdavConnection: jest.fn(),
  webdavUrlProblem: () => null,
  isIcloudSupported: () => false,
  isIcloudBackupOn: () => false,
  setIcloudBackupOn: jest.fn(),
  icloudBackupState: async () => 'unsupported',
  icloudBackend: { id: 'icloud', name: 'iCloud Drive' },
}));

// Rows owned elsewhere, which reach the map and the camera.
jest.mock('@/features/settings/components/ExportPrivacyRow', () => ({
  ExportPrivacyRow: () => null,
}));
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: () => null,
}));

const mockPerformBackup = jest.fn();
const mockCancelRun = jest.fn();
let mockProgress: { running: boolean; run?: number; visited: number; total: number } = {
  running: false,
  visited: 0,
  total: 0,
};
let mockRecordRun: number | undefined;
let rejectBulk: (err: unknown) => void = () => {};
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getUnplacedBackupRecords: async () => [],
    runBulkExport: () =>
      new Promise((_resolve, reject) => {
        rejectBulk = reject;
      }),
    bulkExportProgress: () => mockProgress,
    getBackupScreenData: () => ({ recordBackupRun: mockRecordRun }),
    cancelRun: (run: number) => mockCancelRun(run),
  }),
  getRouteDbPath: () => '/data/veloq.db',
  getNativeModule: () => ({}),
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: jest.fn(),
}));

const cancelled = () => Object.assign(new Error('Cancelled'), { tag: 'Cancelled' });

beforeEach(() => {
  jest.useFakeTimers();
  mockCancelRun.mockReset().mockReturnValue(true);
  mockPerformBackup.mockReset();
  mockProgress = { running: false, visited: 0, total: 0 };
  mockRecordRun = undefined;
});

afterEach(() => {
  jest.useRealTimers();
});

it('stops a running bulk export from its row and says it was cancelled', async () => {
  await render(<BackupSection />);
  expect(screen.queryByTestId('bulk-export-cancel')).toBeNull();

  mockProgress = { running: true, run: 21, visited: 40, total: 402 };
  void fireEvent.press(screen.getByText('GPX'));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });

  mockCancelRun.mockImplementation(() => {
    rejectBulk(cancelled());
    return true;
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('bulk-export-cancel'));
    await jest.advanceTimersByTimeAsync(1_100);
  });

  expect(mockCancelRun).toHaveBeenCalledWith(21);
  expect(screen.getByTestId('bulk-export-cancelled')).toHaveTextContent('common.cancelled');
  expect(screen.getByText('GPX')).toBeTruthy();
});

it('swaps Back Up Now for Cancel while the backup runs and stops that run', async () => {
  let rejectBackup: (err: unknown) => void = () => {};
  mockPerformBackup.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectBackup = reject;
      })
  );
  mockRecordRun = 33;
  mockCancelRun.mockImplementation(() => {
    rejectBackup(cancelled());
    return true;
  });
  await render(<BackupSection />);
  expect(screen.getByTestId('backup-now-button')).toHaveTextContent('backup.backupNow');

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-now-button'));
    await jest.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByTestId('backup-now-button')).toHaveTextContent('common.cancel');

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-now-button'));
    await jest.advanceTimersByTimeAsync(10);
  });

  expect(mockCancelRun).toHaveBeenCalledWith(33);
  expect(screen.getByTestId('backup-cancelled')).toHaveTextContent('common.cancelled');
  expect(screen.queryByTestId('backup-error-message')).toBeNull();
  expect(screen.getByTestId('backup-now-button')).toHaveTextContent('backup.backupNow');
});
