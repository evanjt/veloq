import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ProfileAccountSection } from '@/features/settings/components/ProfileAccountSection';
import * as haptics from '@/shared/ui/haptics';
import { clearAccountData, clearAuthOnly } from '@/shared/storage';
import { useAuthStore } from '@/shared/app/AuthStore';
import { exportRecordBackup } from '@/features/settings/lib/backup';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
  useIsOnline: () => true,
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ cancelQueries: jest.fn(async () => {}), clear: jest.fn() }),
}));
jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));
jest.mock('@/features/settings/lib/backup', () => ({
  ...jest.requireActual('@/features/settings/lib/backup'),
  exportRecordBackup: jest.fn(async () => 'complete'),
}));
jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  clearAccountData: jest.fn(),
  clearAuthOnly: jest.fn(),
}));

/** The recording table with one ride waiting to upload, as the engine holds it. */
const mockRecordings = new Map<string, { id: string; uploadStatus: string }>();
const mockDemote = () => {
  for (const row of mockRecordings.values()) {
    if (['pending', 'uploading', 'permissionBlocked'].includes(row.uploadStatus)) {
      row.uploadStatus = 'localOnly';
    }
  }
};
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    ready: true,
    demoteRecordingsToLocalOnly: mockDemote,
    listRecordings: () => [...mockRecordings.values()],
  }),
}));

beforeEach(() => {
  jest.mocked(haptics.medium).mockClear();
  jest.mocked(clearAccountData).mockReset();
  jest.mocked(clearAuthOnly).mockReset();
  mockRecordings.clear();
  mockRecordings.set('r1', { id: 'r1', uploadStatus: 'pending' });
});

/**
 * Scenario: the athlete records with no signal, signs out to fix a login and
 * signs straight back in as themselves.
 *
 * Expected behaviour: the ride is still queued. A sign-out demotes nothing:
 * the hold at the next sign-in is what keeps a ride out of another athlete's
 * account, and it leaves the athlete's own rides where they were.
 */
it.each([
  ['settings-logout-button', 'a plain sign-out'],
  ['settings-logout-clear-button', 'a sign-out that clears the data'],
])('%s leaves a queued ride queued (%s)', async (button) => {
  const clearCredentials = jest.fn(async () => {});
  useAuthStore.setState({ authMethod: 'oauth', clearCredentials });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    await render(<ProfileAccountSection />);
    await fireEvent.press(screen.getByTestId(button));
    const buttons = alert.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await waitFor(() => expect(clearCredentials).toHaveBeenCalled());
    expect(alert).toHaveBeenCalledTimes(1);
    expect(mockRecordings.get('r1')?.uploadStatus).toBe('pending');
  } finally {
    alert.mockRestore();
  }
});

it('reports a failed destructive wipe without signing out', async () => {
  const clearCredentials = jest.fn(async () => {});
  useAuthStore.setState({ authMethod: 'oauth', clearCredentials });
  jest.mocked(clearAccountData).mockRejectedValueOnce(new Error('wipe failed'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    await render(<ProfileAccountSection />);
    await fireEvent.press(screen.getByTestId('settings-logout-clear-button'));
    const buttons = alert.mock.calls[0][2];
    await act(async () => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
      await Promise.resolve();
    });
    expect(clearCredentials).not.toHaveBeenCalled();
    expect(alert).toHaveBeenLastCalledWith(
      'alerts.disconnectFailedTitle',
      'alerts.failedToDisconnect',
      undefined,
      expect.objectContaining({ cancelable: true })
    );
  } finally {
    alert.mockRestore();
  }
});

/**
 * Scenario: both sign-outs confirm through an alert.
 * Expected behaviour: accepting fires one medium impact; cancelling fires none.
 */
describe.each([
  ['settings-logout-button', 'a plain sign-out'],
  ['settings-logout-clear-button', 'a sign-out that clears the data'],
])('%s haptic (%s)', (button) => {
  async function openConfirm() {
    useAuthStore.setState({
      authMethod: 'oauth',
      clearCredentials: jest.fn(async () => {}),
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<ProfileAccountSection />);
    await fireEvent.press(screen.getByTestId(button));
    return { alert, buttons: alert.mock.calls[0][2] };
  }

  it('fires one medium impact when accepted', async () => {
    const { alert, buttons } = await openConfirm();
    try {
      expect(haptics.medium).not.toHaveBeenCalled();
      await act(async () => {
        buttons?.find((b) => b.style === 'destructive')?.onPress?.();
      });
      expect(haptics.medium).toHaveBeenCalledTimes(1);
    } finally {
      alert.mockRestore();
    }
  });

  it('fires nothing when cancelled', async () => {
    const { alert, buttons } = await openConfirm();
    try {
      await act(async () => {
        buttons?.find((b) => b.style === 'cancel')?.onPress?.();
      });
      expect(haptics.medium).not.toHaveBeenCalled();
    } finally {
      alert.mockRestore();
    }
  });
});

/**
 * Scenario: the athlete opens Sign out and delete data, which deletes their
 * local backups, names, trims, pins and paired sensors for good.
 *
 * Expected behaviour: the confirm lists what is deleted for good and offers a
 * backup first. The backup runs the record export, deletes nothing and signs
 * nobody out, and the confirm opens again once the file has been offered.
 */
describe('Sign out and delete data confirm', () => {
  async function openConfirm() {
    const clearCredentials = jest.fn(async () => {});
    useAuthStore.setState({ authMethod: 'oauth', clearCredentials });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<ProfileAccountSection />);
    await fireEvent.press(screen.getByTestId('settings-logout-clear-button'));
    return { alert, clearCredentials };
  }

  beforeEach(() => {
    jest.mocked(exportRecordBackup).mockReset();
    jest.mocked(exportRecordBackup).mockResolvedValue('complete');
  });

  it('lists what comes back and what is deleted for good', async () => {
    const { alert } = await openConfirm();
    try {
      const message = alert.mock.calls[0][1] ?? '';
      expect(message).toContain('alerts.wipeList.returns');
      expect(message).toContain('alerts.wipeList.deleted');
      expect(message).toContain('alerts.wipeList.localBackups');
      expect(message).toContain('alerts.wipeList.backupSetup');
      expect(message).toContain('alerts.wipeList.sensors');
    } finally {
      alert.mockRestore();
    }
  });

  it('backs up first, then asks again without deleting anything', async () => {
    const { alert, clearCredentials } = await openConfirm();
    try {
      const backUp = alert.mock.calls[0][2]?.find(
        (b) => b.text === 'alerts.disconnectAndClearBackUpFirst'
      );
      expect(backUp).toBeDefined();
      expect(backUp?.style).not.toBe('destructive');

      await act(async () => {
        backUp?.onPress?.();
      });

      await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
      expect(exportRecordBackup).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls[1][0]).toBe(alert.mock.calls[0][0]);
      expect(alert.mock.calls[1][1]).toBe(alert.mock.calls[0][1]);
      expect(clearAccountData).not.toHaveBeenCalled();
      expect(clearCredentials).not.toHaveBeenCalled();
    } finally {
      alert.mockRestore();
    }
  });

  it('does not ask again when the backup failed', async () => {
    jest.mocked(exportRecordBackup).mockRejectedValueOnce(new Error('disk full'));
    const { alert, clearCredentials } = await openConfirm();
    try {
      const backUp = alert.mock.calls[0][2]?.find(
        (b) => b.text === 'alerts.disconnectAndClearBackUpFirst'
      );
      await act(async () => {
        backUp?.onPress?.();
      });

      await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
      expect(alert.mock.calls[1][0]).toBe('backup.notSavedTitle');
      expect(clearAccountData).not.toHaveBeenCalled();
      expect(clearCredentials).not.toHaveBeenCalled();
    } finally {
      alert.mockRestore();
    }
  });
});
