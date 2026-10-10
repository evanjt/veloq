/**
 * Scenario: Veloq was deleted and installed again on an Android phone, and the athlete opens the
 * restore choices on the login screen before signing in to intervals.icu.
 *
 * Expected behaviour: Google Drive is offered. Tapping it signs in to Google and lists the
 * backups Veloq's own app data folder holds, each one restorable. A dismissed sign-in lists
 * nothing. On iOS there is no Google Drive choice.
 */
import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { RestoreChooser } from '@/features/settings/components/RestoreChooser';
import { initialiseI18n } from '@/i18n';

const mockSignIn = jest.fn<Promise<string | null>, []>();
const mockList = jest.fn();
const mockRestore = jest.fn();

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
  signInToGoogleDrive: () => mockSignIn(),
  isGoogleDriveSupported: () => jest.requireActual('react-native').Platform.OS === 'android',
}));
jest.mock('@/features/settings/lib/restoreBackendEntry', () => ({
  restoreBackendEntry: (...args: unknown[]) => mockRestore(...args),
}));

const os = Platform.OS;

function onPlatform(platform: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
}

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  mockSignIn.mockReset();
  mockList.mockReset();
  mockRestore.mockReset();
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
});

describe('restoring from Google Drive', () => {
  it('signs in and lists the backups in the app data folder on Android', async () => {
    onPlatform('android');
    mockSignIn.mockResolvedValue('rider@example.org');
    mockList.mockResolvedValue([
      { id: 'veloq-2026-06-16T08-00-00-000Z.zip', timestamp: '2026-06-16T08:00:00.000Z' },
      { id: 'veloq-2026-06-10T08-00-00-000Z.zip', timestamp: '2026-06-10T08:00:00.000Z' },
    ]);
    mockRestore.mockResolvedValue({ title: 'done', message: 'restored' });

    render(<RestoreChooser />);
    fireEvent.press(screen.getByTestId('restore-chooser-google-drive'));

    await waitFor(() =>
      expect(
        screen.getByTestId('restore-chooser-entry-googleDrive-veloq-2026-06-16T08-00-00-000Z.zip')
      ).toBeTruthy()
    );
    expect(
      screen.getByTestId('restore-chooser-entry-googleDrive-veloq-2026-06-10T08-00-00-000Z.zip')
    ).toBeTruthy();
    expect(screen.getByText('rider@example.org')).toBeTruthy();

    fireEvent.press(
      screen.getByTestId('restore-chooser-entry-googleDrive-veloq-2026-06-10T08-00-00-000Z.zip')
    );
    await waitFor(() => expect(mockRestore).toHaveBeenCalledTimes(1));
    expect(mockRestore.mock.calls[0][0].id).toBe('googleDrive');
    expect(mockRestore.mock.calls[0][1].id).toBe('veloq-2026-06-10T08-00-00-000Z.zip');
  });

  it('lists nothing when the athlete dismisses the Google sign-in', async () => {
    onPlatform('android');
    mockSignIn.mockResolvedValue(null);

    render(<RestoreChooser />);
    fireEvent.press(screen.getByTestId('restore-chooser-google-drive'));

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
    expect(mockList).not.toHaveBeenCalled();
    expect(screen.queryByTestId('restore-chooser-none')).toBeNull();
  });

  it('offers no Google Drive choice on iOS', () => {
    onPlatform('ios');
    render(<RestoreChooser />);
    expect(screen.queryByTestId('restore-chooser-google-drive')).toBeNull();
  });
});
