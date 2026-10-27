/**
 * Scenario: an OAuth athlete whose token predates the write scope cannot upload
 * a recording. The only prompt was a dismissible banner on the recordings
 * screen, so once dismissed there was nowhere to grant access from.
 *
 * Expected behaviour: Settings carries a Recording group linking to recording
 * settings, where the grant control sits beside Auto-upload, whenever an OAuth
 * athlete has no confirmed write permission, and carries nothing when the
 * permission is confirmed or the athlete signed in with an API key.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import SettingsScreen from '@/app/(tabs)/settings';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());

const mockNavigateTo = jest.fn();
jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTo: (...a: unknown[]) => mockNavigateTo(...a),
}));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
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
  useMapPreferences: (...args: unknown[]) =>
    jest.requireMock('@/features/settings/stores/MapPreferencesContext').useMapPreferences(...args),
  useDashboardPreferences: jest.requireActual('@/features/settings/stores/summaryCardPreferences')
    .useDashboardPreferences,
  useNotificationPreferences: jest.requireActual(
    '@/features/settings/stores/NotificationPreferencesStore'
  ).useNotificationPreferences,
  useLastBackupTimestamp: () => null,
  useGarminConnectorState: () => null,
  useExperimental: () => false,
  useAutoBackupEnabled: () => true,
  SettingsNavRow: jest.requireActual('@/features/settings/components/SettingsNavRow')
    .SettingsNavRow,
  RecordingPermissionSection: jest.requireActual(
    '@/features/settings/components/RecordingPermissionSection'
  ).RecordingPermissionSection,
  settingsStyles: jest.requireActual('@/features/settings/components/settingsStyles')
    .settingsStyles,
  SupportSection: () => null,
  FooterSection: () => null,
}));

function signIn(authMethod: 'oauth' | 'apiKey' | 'demo') {
  useAuthStore.setState({ authMethod });
}

describe('Settings recording permission', () => {
  beforeEach(() => {
    mockNavigateTo.mockClear();
    useUploadPermissionStore.setState({ hasWritePermission: null, isLoaded: true });
    signIn('oauth');
  });

  it('waits for permission hydration before pointing at the grant', async () => {
    useUploadPermissionStore.getState().reset();
    const { queryByTestId, getByTestId } = await render(<SettingsScreen />);
    expect(queryByTestId('settings-recording-permission-link')).toBeNull();

    await act(() => useUploadPermissionStore.getState().setFromOAuthScope(''));
    expect(getByTestId('settings-recording-permission-link')).toBeTruthy();
  });

  it('links to recording settings when an OAuth token has no confirmed write permission', async () => {
    const { getByTestId, queryByTestId } = await render(<SettingsScreen />);
    expect(queryByTestId('settings-grant-access')).toBeNull();
    fireEvent.press(getByTestId('settings-recording-permission-link'));
    expect(mockNavigateTo).toHaveBeenCalledWith('/recording-settings');
  });

  it('puts the notice above every group, under the account card', async () => {
    const { toJSON } = await render(<SettingsScreen />);
    const order: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (!node || typeof node !== 'object') {
        return;
      }
      const el = node as { props?: Record<string, unknown>; children?: unknown };
      const id = el.props?.testID;
      if (
        typeof id === 'string' &&
        /^settings-(account-row|group-|recording-permission)/.test(id)
      ) {
        order.push(id);
      }
      walk(el.children);
    };
    walk(toJSON());
    expect(order.slice(0, 3)).toEqual([
      'settings-account-row',
      'settings-recording-permission-link',
      'settings-group-shows',
    ]);
  });

  it('links there when the write scope was explicitly refused', async () => {
    useUploadPermissionStore.setState({ hasWritePermission: false });
    const { getByTestId } = await render(<SettingsScreen />);
    expect(getByTestId('settings-recording-permission-link')).toBeTruthy();
  });

  it('says nothing once the write permission is confirmed', async () => {
    useUploadPermissionStore.setState({ hasWritePermission: true });
    const { queryByTestId } = await render(<SettingsScreen />);
    expect(queryByTestId('settings-recording-permission-link')).toBeNull();
  });

  it.each(['apiKey', 'demo'] as const)('says nothing for a %s sign-in', async (authMethod) => {
    signIn(authMethod);
    const { queryByTestId } = await render(<SettingsScreen />);
    expect(queryByTestId('settings-recording-permission-link')).toBeNull();
  });
});
