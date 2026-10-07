/**
 * Scenario: an OAuth athlete whose token predates the write scope cannot upload
 * a recording. The only prompt was a dismissible banner on the recordings
 * screen, so once dismissed there was nowhere to grant access from.
 *
 * Expected behaviour: Settings carries a Recording group with a Grant Access
 * control whenever an OAuth athlete has no confirmed write permission, and
 * carries nothing when the permission is confirmed or the athlete signed in
 * with an API key.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

import SettingsScreen from '@/app/settings';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'outdoors', terrain3DMode: 'off' },
  }),
}));

jest.mock('@/shared/app/useAthlete', () => ({
  useAthlete: () => ({ athlete: null }),
}));

jest.mock('@/shared/storage/gpsStorage', () => ({
  getAppStorageSize: jest.fn().mockResolvedValue(0),
}));

jest.mock('@/features/settings/lib/autobackup', () => ({
  getLastBackupTimestamp: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/features/settings', () => ({
  useNotificationPreferences: jest.requireActual(
    '@/features/settings/stores/NotificationPreferencesStore'
  ).useNotificationPreferences,
  useLastBackupTimestamp: () => null,
  useAutoBackupEnabled: () => true,
}));

jest.mock('@/features/settings/components', () => ({
  SupportSection: () => null,
  FooterSection: () => null,
}));

const mockUpgradePermissions = jest.fn();
jest.mock('@/features/recording/hooks/usePermissionUpgrade', () => ({
  usePermissionUpgrade: () => ({
    upgradePermissions: mockUpgradePermissions,
    isUpgrading: false,
    error: null,
  }),
}));

function signIn(authMethod: 'oauth' | 'apiKey' | 'demo') {
  useAuthStore.setState({ authMethod });
}

describe('Settings recording permission', () => {
  beforeEach(() => {
    useUploadPermissionStore.setState({ hasWritePermission: null, isLoaded: true });
    signIn('oauth');
  });

  it('waits for permission hydration before offering an upgrade', () => {
    useUploadPermissionStore.getState().reset();
    const { queryByTestId, getByTestId } = render(<SettingsScreen />);
    expect(queryByTestId('settings-grant-access')).toBeNull();

    act(() => useUploadPermissionStore.getState().setFromOAuthScope(''));
    expect(getByTestId('settings-grant-access')).toBeTruthy();
  });

  it('offers Grant Access when an OAuth token has no confirmed write permission', () => {
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId('settings-grant-access')).toBeTruthy();
  });

  it('says recording works without write permission rather than requiring it', () => {
    const { queryByText, getByText } = render(<SettingsScreen />);
    expect(queryByText(/requires write permission/i)).toBeNull();
    expect(getByText(/Recording works without it/)).toBeTruthy();
  });

  it('offers Grant Access when the write scope was explicitly refused', () => {
    useUploadPermissionStore.setState({ hasWritePermission: false });
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId('settings-grant-access')).toBeTruthy();
  });

  it('says nothing once the write permission is confirmed', () => {
    useUploadPermissionStore.setState({ hasWritePermission: true });
    const { queryByTestId } = render(<SettingsScreen />);
    expect(queryByTestId('settings-grant-access')).toBeNull();
  });

  it.each(['apiKey', 'demo'] as const)('says nothing for a %s sign-in', (authMethod) => {
    signIn(authMethod);
    const { queryByTestId } = render(<SettingsScreen />);
    expect(queryByTestId('settings-grant-access')).toBeNull();
  });
});
