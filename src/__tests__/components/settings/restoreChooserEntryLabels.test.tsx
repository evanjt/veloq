/**
 * Scenario: the restore choices list two Google Drive backups made on one day,
 * and the athlete restores one of them.
 *
 * Expected behaviour: each entry reads with its own time, size and version,
 * and while the restore runs only the entry being restored is busy.
 */
import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { RestoreChooser } from '@/features/settings/components/RestoreChooser';
import { formatDateTime } from '@/shared/format/format';
import { initialiseI18n } from '@/i18n';

const mockList = jest.fn();
let mockFinishRestore: () => void = () => {};

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/settings/hooks/useBackup', () => ({
  useImportDatabaseBackup: () => ({ importDatabaseBackup: jest.fn(), importing: false }),
  confirmLegacyImport: async () => true,
}));
jest.mock('@/features/settings/components/WebdavConfigForm', () => ({
  WebdavConfigForm: () => null,
}));
jest.mock('@/features/settings/lib/autobackup/backends/googleDriveBackend', () => ({
  googleDriveBackend: {
    id: 'googleDrive',
    isAvailable: async () => true,
    listBackups: () => mockList(),
  },
  signInToGoogleDrive: async () => 'rider@example.org',
  isGoogleDriveSupported: () => true,
}));
jest.mock('@/features/settings/lib/restoreBackendEntry', () => ({
  restoreBackendEntry: () =>
    new Promise((resolve) => {
      mockFinishRestore = () => resolve({ title: 'done', message: 'restored' });
    }),
}));
jest.mock('@/features/settings/lib/restoreNotice', () => ({ showRestoreNotice: jest.fn() }));

const DAWN = {
  id: 'veloq-2026-03-14T06-30-00-000Z.zip',
  timestamp: '2026-03-14T06:30:00.000Z',
  sizeBytes: 2_400_000,
  appVersion: '0.4.0',
};
const EVENING = {
  id: 'veloq-2026-03-14T18-10-00-000Z.zip',
  timestamp: '2026-03-14T18:10:00.000Z',
  sizeBytes: 2_450_000,
  appVersion: '0.4.0',
};
const entryId = (id: string) => `restore-chooser-entry-googleDrive-${id}`;

const os = Platform.OS;

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  mockList.mockResolvedValue([EVENING, DAWN]);
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
});

async function listDrive() {
  await render(<RestoreChooser />);
  await fireEvent.press(screen.getByTestId('restore-chooser-google-drive'));
  await waitFor(() => expect(screen.getByTestId(entryId(DAWN.id))).toBeTruthy());
}

it('labels two backups from one day apart, by time and size', async () => {
  await listDrive();

  const dawn = screen.getByTestId(entryId(DAWN.id)).props.accessibilityLabel as string;
  const evening = screen.getByTestId(entryId(EVENING.id)).props.accessibilityLabel as string;
  expect(dawn).not.toBe(evening);
  expect(dawn).toContain(formatDateTime(DAWN.timestamp));
  expect(evening).toContain(formatDateTime(EVENING.timestamp));
  expect(dawn).toContain('2.4 MB');
  expect(evening).toContain('2.5 MB');
  expect(screen.getByText(new RegExp(formatDateTime(DAWN.timestamp)))).toBeTruthy();
  expect(screen.getByText(new RegExp(formatDateTime(EVENING.timestamp)))).toBeTruthy();
});

it('marks only the entry being restored busy while the restore runs', async () => {
  await listDrive();

  await act(async () => {
    fireEvent.press(screen.getByTestId(entryId(DAWN.id)));
  });

  expect(screen.getByTestId(entryId(DAWN.id)).props.accessibilityState).toMatchObject({
    busy: true,
  });
  expect(screen.getByTestId(entryId(EVENING.id)).props.accessibilityState?.busy).toBeFalsy();
  expect(screen.getByTestId(entryId(EVENING.id)).props.accessibilityState).toMatchObject({
    disabled: true,
  });

  await act(async () => {
    mockFinishRestore();
  });
  expect(screen.getByTestId(entryId(DAWN.id)).props.accessibilityState?.busy).toBeFalsy();
});
