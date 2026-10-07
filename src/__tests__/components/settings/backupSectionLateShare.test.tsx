/**
 * Scenario: a whole-library export outlives the foreground minute and lands
 * while the screen is still open, so its share sheet opens late.
 *
 * Expected behaviour: the row says it is opening the share sheet, and not also
 * that the export is still running and the screen can be left.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { BackupSection } from '@/features/settings/components/BackupSection';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/native/useSyncStatus', () => ({ useSyncStatus: () => null }));

jest.mock('@/shared/native/useActivityCount', () => ({ useActivityCount: () => 402 }));

jest.mock('@/shared/native/useEngineSubscription', () => ({
  useEngineRead: () => (read: (engine: { getUnplacedBackupRecords: () => unknown[] }) => unknown) =>
    read({ getUnplacedBackupRecords: () => [] }),
  useEngineSubscription: () => 0,
}));

jest.mock('@/features/settings/lib/autobackup', () => ({
  isAutoBackupEnabled: () => false,
  setAutoBackupEnabled: jest.fn(),
  getLastBackupTimestamp: () => null,
  getUnplacedBackupRecords: async () => [],
  getBackupFailures: () => ({}),
  getBackupFolderName: () => null,
  pickBackupFolder: jest.fn(),
  forgetBackupFolder: jest.fn(),
  folderBackend: { id: 'folder', name: 'Folder' },
  failureMessageKey: () => 'backup.backupFailedMessage',
  performBackup: jest.fn(),
  localBackend: { id: 'local', name: 'Local' },
  webdavBackend: { id: 'webdav', name: 'WebDAV' },
  getWebdavConfig: () => null,
  setWebdavConfig: jest.fn(),
  testWebdavConnection: jest.fn(),
  webdavUrlProblem: () => null,
}));

// Rows owned elsewhere, which reach the map and the camera.
jest.mock('@/features/settings/components/ExportPrivacyRow', () => ({
  ExportPrivacyRow: () => null,
}));
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: () => null,
}));

let mockProgress = { running: false, visited: 0, total: 0 };
let mockFinishWrite: (written: unknown) => void = () => {};
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getUnplacedBackupRecords: async () => [],
    runBulkExport: () =>
      new Promise((res) => {
        mockFinishWrite = res;
      }),
    bulkExportProgress: () => mockProgress,
  }),
  getRouteDbPath: () => '/data/veloq.db',
  getNativeModule: () => ({}),
}));

// The share sheet stays up until the test closes it.
let mockCloseSheet: () => void = () => {};
jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: () =>
    new Promise<void>((res) => {
      mockCloseSheet = res;
    }),
}));

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('says it is sharing, and not still running, while a late share sheet is up', async () => {
  render(<BackupSection />);
  mockProgress = { running: true, visited: 150, total: 402 };
  fireEvent.press(screen.getByText('GPX'));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(61_000);
  });
  expect(screen.getByTestId('bulk-export-still-running')).toBeTruthy();

  mockProgress = { running: false, visited: 0, total: 0 };
  await act(async () => {
    mockFinishWrite({ exported: 402, noTrack: 0, trimmed: 0, failed: 0, totalBytes: 2048 });
    await jest.advanceTimersByTimeAsync(600);
  });

  expect(screen.getByText('export.bulkSharing')).toBeTruthy();
  expect(screen.queryByTestId('bulk-export-still-running')).toBeNull();

  await act(async () => {
    mockCloseSheet();
    await jest.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByText('GPX')).toBeTruthy();
});
