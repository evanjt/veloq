/**
 * Scenario: a whole-library export is running and the worker reports how far
 * it has got, four times a second.
 *
 * Expected behaviour: the bulk export row on the backup screen shows that
 * count, not only a spinner.
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
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getUnplacedBackupRecords: async () => [],
    runBulkExport: () => new Promise(() => {}),
    bulkExportProgress: () => mockProgress,
  }),
  getRouteDbPath: () => '/data/veloq.db',
  getNativeModule: () => ({}),
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: jest.fn(),
}));

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('shows the count the worker reports while the export runs', async () => {
  render(<BackupSection />);
  expect(screen.queryByTestId('bulk-export-count')).toBeNull();

  mockProgress = { running: true, visited: 150, total: 402 };
  fireEvent.press(screen.getByText('GPX'));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });

  expect(screen.getByTestId('bulk-export-count')).toHaveTextContent(
    'export.bulkCount:{"current":150,"total":402}'
  );
  expect(screen.queryByTestId('bulk-export-spinner')).toBeNull();
});

it('keeps showing the count once the foreground wait lapses and the worker runs on', async () => {
  render(<BackupSection />);
  mockProgress = { running: true, visited: 150, total: 402 };
  fireEvent.press(screen.getByText('GPX'));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(61_000);
  });
  mockProgress = { running: true, visited: 380, total: 402 };
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });

  expect(screen.getByTestId('bulk-export-still-running')).toBeTruthy();
  expect(screen.getByTestId('bulk-export-count')).toHaveTextContent(
    'export.bulkCount:{"current":380,"total":402}'
  );
});
