/**
 * Scenario: Veloq was deleted and installed again on an iPhone, and the athlete opens the restore
 * choices on the login screen before signing in to intervals.icu.
 *
 * Expected behaviour: iCloud Drive is offered with nothing to sign in to. Tapping it lists the
 * backups in Veloq's own iCloud folder, each one restorable. An iPhone signed out of iCloud is
 * told why nothing lists. On Android there is no iCloud choice.
 */
import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { RestoreChooser } from '@/features/settings/components/RestoreChooser';
import { BackupTransferError } from '@/features/settings/lib/autobackup/backends/errors';
import { initialiseI18n } from '@/i18n';
import { inform } from '@/shared/ui/dialog';

const mockList = jest.fn();
const mockRestore = jest.fn();

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/ui/dialog', () => ({
  ...jest.requireActual('@/shared/ui/dialog'),
  inform: jest.fn(),
}));
jest.mock('@/features/settings/hooks/useBackup', () => ({
  useImportDatabaseBackup: () => ({ importDatabaseBackup: jest.fn(), importing: false }),
  confirmLegacyImport: async () => true,
}));
jest.mock('@/features/settings/components/WebdavConfigForm', () => ({
  WebdavConfigForm: () => null,
}));
jest.mock('@/features/settings/lib/autobackup/backends/icloudBackend', () => ({
  icloudBackend: {
    id: 'icloud',
    isAvailable: async () => true,
    listBackups: () => mockList(),
  },
  isIcloudSupported: () => jest.requireActual('react-native').Platform.OS === 'ios',
}));
jest.mock('@/features/settings/lib/restoreBackendEntry', () => ({
  restoreBackendEntry: (...args: unknown[]) => mockRestore(...args),
}));

const os = Platform.OS;
const NEWER = 'veloq-2026-06-16T08-00-00-000Z.zip';
const OLDER = 'veloq-2026-06-10T08-00-00-000Z.zip';

function onPlatform(platform: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
}

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  mockList.mockReset();
  mockRestore.mockReset();
  jest.mocked(inform).mockReset();
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
});

describe('restoring from iCloud Drive', () => {
  it('lists the backups in Veloq’s iCloud folder on iPhone and restores the one chosen', async () => {
    onPlatform('ios');
    mockList.mockResolvedValue([
      { id: NEWER, timestamp: '2026-06-16T08:00:00.000Z' },
      { id: OLDER, timestamp: '2026-06-10T08:00:00.000Z' },
    ]);
    mockRestore.mockResolvedValue({ title: 'done', message: 'restored' });

    await render(<RestoreChooser />);
    await fireEvent.press(screen.getByTestId('restore-chooser-icloud'));

    await waitFor(() =>
      expect(screen.getByTestId(`restore-chooser-entry-icloud-${NEWER}`)).toBeTruthy()
    );
    expect(screen.getByTestId(`restore-chooser-entry-icloud-${OLDER}`)).toBeTruthy();

    await fireEvent.press(screen.getByTestId(`restore-chooser-entry-icloud-${OLDER}`));
    await waitFor(() => expect(mockRestore).toHaveBeenCalledTimes(1));
    expect(mockRestore.mock.calls[0][0].id).toBe('icloud');
    expect(mockRestore.mock.calls[0][1].id).toBe(OLDER);
  });

  it('says so when the folder holds no backup', async () => {
    onPlatform('ios');
    mockList.mockResolvedValue([]);

    await render(<RestoreChooser />);
    await fireEvent.press(screen.getByTestId('restore-chooser-icloud'));

    await waitFor(() => expect(screen.getByTestId('restore-chooser-icloud-none')).toBeTruthy());
  });

  it('tells an iPhone signed out of iCloud why nothing lists', async () => {
    onPlatform('ios');
    mockList.mockRejectedValue(
      new BackupTransferError('List backups', 'icloud_unavailable', 'iCloud is not available')
    );

    await render(<RestoreChooser />);
    await fireEvent.press(screen.getByTestId('restore-chooser-icloud'));

    await waitFor(() => expect(inform).toHaveBeenCalledTimes(1));
    expect(jest.mocked(inform).mock.calls[0][0].message).toMatch(/iCloud/);
    expect(screen.queryByTestId('restore-chooser-icloud-none')).toBeNull();
  });

  it('offers no iCloud choice on Android', async () => {
    onPlatform('android');
    await render(<RestoreChooser />);
    expect(screen.queryByTestId('restore-chooser-icloud')).toBeNull();
  });
});
