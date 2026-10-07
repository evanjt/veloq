import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ProfileAccountSection } from '@/features/settings/components/ProfileAccountSection';
import { clearAccountData, clearAuthOnly } from '@/shared/storage';
import { useAuthStore } from '@/shared/app/AuthStore';

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
    render(<ProfileAccountSection />);
    fireEvent.press(screen.getByTestId(button));
    const buttons = alert.mock.calls[0][2];
    await act(async () => {
      buttons?.[1]?.onPress?.();
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
    render(<ProfileAccountSection />);
    fireEvent.press(screen.getByTestId('settings-logout-clear-button'));
    const buttons = alert.mock.calls[0][2];
    await act(async () => {
      buttons?.[1]?.onPress?.();
      await Promise.resolve();
    });
    expect(clearCredentials).not.toHaveBeenCalled();
    expect(alert).toHaveBeenLastCalledWith('alerts.error', 'alerts.failedToDisconnect');
  } finally {
    alert.mockRestore();
  }
});
