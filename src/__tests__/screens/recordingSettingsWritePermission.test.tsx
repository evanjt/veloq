/**
 * Scenario: an OAuth athlete whose token lacks the write scope turns Auto-upload
 * on in recording settings. A save then stays on the device, because an upload
 * needs that scope, while the switch reads On and the only grant control sat on
 * another screen.
 *
 * Expected behaviour: the Upload card says the permission is missing and that
 * uploads wait for it, with a Grant Access control beside the switch, and says
 * nothing once the scope is confirmed or the athlete signed in another way.
 */
import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';

import RecordingSettingsScreen from '@/app/recording-settings';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/shared/app/navigation', () => ({
  navigateTo: jest.fn(),
  tapTo: jest.fn(),
  goBack: jest.fn(),
}));

const mockUpgradePermissions = jest.fn();
jest.mock('@/features/recording/hooks/usePermissionUpgrade', () => ({
  usePermissionUpgrade: () => ({
    upgradePermissions: mockUpgradePermissions,
    isUpgrading: false,
    error: null,
  }),
}));

beforeEach(() => {
  mockUpgradePermissions.mockClear();
  useAuthStore.setState({ authMethod: 'oauth' });
  useUploadPermissionStore.setState({ hasWritePermission: null, isLoaded: true });
  useRecordingPreferences.setState({ autoUploadEnabled: true });
});

describe('recording settings write permission', () => {
  it('puts Grant Access in the Upload card when an OAuth token has no write scope', async () => {
    const view = await render(<RecordingSettingsScreen />);
    const card = view.getByTestId('settings-upload-card');
    expect(within(card).getByTestId('settings-auto-upload')).toBeTruthy();
    expect(within(card).getByTestId('settings-grant-access')).toBeTruthy();
    expect(within(card).getByText(/Write permission not granted/)).toBeTruthy();
    expect(within(card).getByText(/Uploads wait/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(within(card).getByTestId('settings-grant-access'));
    });
    expect(mockUpgradePermissions).toHaveBeenCalledTimes(1);
  });

  it('offers it when the write scope was explicitly refused', async () => {
    useUploadPermissionStore.setState({ hasWritePermission: false });
    const view = await render(<RecordingSettingsScreen />);
    expect(view.getByTestId('settings-grant-access')).toBeTruthy();
  });

  it('offers it with Auto-upload off too, since a manual upload needs the same scope', async () => {
    useRecordingPreferences.setState({ autoUploadEnabled: false });
    const view = await render(<RecordingSettingsScreen />);
    expect(view.getByTestId('settings-grant-access')).toBeTruthy();
  });

  it('waits for permission hydration before offering it', async () => {
    useUploadPermissionStore.getState().reset();
    const view = await render(<RecordingSettingsScreen />);
    expect(view.queryByTestId('settings-grant-access')).toBeNull();

    await act(() => useUploadPermissionStore.getState().setFromOAuthScope(''));
    expect(view.getByTestId('settings-grant-access')).toBeTruthy();
  });

  it('says nothing once the write scope is confirmed', async () => {
    useUploadPermissionStore.setState({ hasWritePermission: true });
    const view = await render(<RecordingSettingsScreen />);
    expect(view.queryByTestId('settings-grant-access')).toBeNull();
    expect(view.queryByText(/Write permission not granted/)).toBeNull();
  });

  it.each(['apiKey', 'demo'] as const)('says nothing for a %s sign-in', async (authMethod) => {
    useAuthStore.setState({ authMethod });
    const view = await render(<RecordingSettingsScreen />);
    expect(view.queryByTestId('settings-grant-access')).toBeNull();
  });
});
