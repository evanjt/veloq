/**
 * Scenario: the restore offer on an empty feed, for a backup found in Google
 * Drive.
 *
 * Expected behaviour: the card says where the backup was found and when it was
 * made, never that no backup was found. Leaving the feed while the restore runs
 * does not answer the offer: only a tap on the dismiss or a finished restore
 * does.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { RestoreOfferCard } from '@/features/settings/components/RestoreOfferCard';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { formatDateTime } from '@/shared/format/format';
import { i18n, initialiseI18n } from '@/i18n';

const mockSettings = new Map<string, string>();
let mockFinishRestore: () => void = () => {};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key) ?? null,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
  }),
  isEngineReady: () => true,
}));
jest.mock('@/features/settings/lib/restoreBackendEntry', () => ({
  restoreBackendEntry: () =>
    new Promise((resolve) => {
      mockFinishRestore = () => resolve('restored');
    }),
}));
jest.mock('@/features/settings/lib/importBackupFile', () => ({
  confirmLegacyImport: async () => true,
}));
jest.mock('@/shared/ui/Notice', () => ({
  NOTICE_LONG_MS: 1,
  showNotice: jest.fn(),
}));

const driveBackup = {
  source: 'googleDrive' as const,
  backend: { id: 'google-drive' } as never,
  entry: {
    id: 'veloq-2026-06-08.zip',
    timestamp: '2026-06-08T06:30:00.000Z',
    sizeBytes: 2_400_000,
    appVersion: '0.4.0',
  },
};

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  mockSettings.clear();
  useWhatsNewStore.setState({ launchModal: null, restoreOffer: driveBackup });
});

function answered(): boolean {
  return mockSettings.has('__platform_record_answered');
}

describe('the restore offer card', () => {
  it('names Google Drive and when the backup was made, and never says none was found', () => {
    render(<RestoreOfferCard />);
    expect(screen.getByText(i18n.t('backup.restoreOfferFoundGoogleDrive'))).toBeTruthy();
    expect(screen.getByText(new RegExp(formatDateTime(driveBackup.entry.timestamp)))).toBeTruthy();
    expect(screen.getByText(/2\.4 MB/)).toBeTruthy();
    expect(screen.queryByText(/No backup was found/)).toBeNull();
  });

  it('is not answered when it unmounts mid-restore', async () => {
    const { unmount } = render(<RestoreOfferCard />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('restore-offer-restore'));
    });
    unmount();
    expect(answered()).toBe(false);
    expect(useWhatsNewStore.getState().restoreOffer).not.toBeNull();
    await act(async () => mockFinishRestore());
  });

  it('is answered once the restore finishes', async () => {
    render(<RestoreOfferCard />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('restore-offer-restore'));
    });
    expect(answered()).toBe(false);
    await act(async () => mockFinishRestore());
    expect(answered()).toBe(true);
    expect(useWhatsNewStore.getState().restoreOffer).toBeNull();
  });

  it('is answered by the dismiss, which says where a restore stays', async () => {
    render(<RestoreOfferCard />);
    expect(screen.getByText(i18n.t('backup.restoreOfferLater'))).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('restore-offer-dismiss'));
    });
    expect(answered()).toBe(true);
    expect(useWhatsNewStore.getState().restoreOffer).toBeNull();
  });
});
