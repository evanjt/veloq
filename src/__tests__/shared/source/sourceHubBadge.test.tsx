/**
 * Scenario: the settings hub's account row badges the sign-in scheme.
 *
 * Expected behaviour: OAuth, the API key, or Demo, and Demo for a session with
 * no method too, which is where it differs from the profile's badge.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import SettingsScreen from '@/app/(tabs)/settings';
import { useAuthStore, type AuthMethod } from '@/shared/app/AuthStore';
// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').fallbackOrKey());

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

it.each<[AuthMethod, string]>([
  ['oauth', 'settings.authOAuth'],
  ['apiKey', 'settings.authApiKey'],
  ['demo', 'settings.authDemo'],
  [null, 'settings.authDemo'],
])('badges a %s session as %s', async (authMethod, badge) => {
  useAuthStore.setState({ authMethod });
  const tree = await render(<SettingsScreen />);
  expect(tree.getByText(badge)).toBeTruthy();
});
