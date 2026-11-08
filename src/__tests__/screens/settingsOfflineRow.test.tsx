/**
 * Scenario: the device loses its connection while the athlete is in Settings.
 *
 * Expected behaviour: while the device is offline, Settings opens on a row
 * saying so, above the account card, and the row says what still works. Online,
 * the row is absent and the screen starts on the account card as it always did.
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';

import SettingsScreen from '@/app/(tabs)/settings';
import { useAuthStore } from '@/shared/app/AuthStore';

let mockOnline = true;

jest.mock('@/shared/app/NetworkContext', () => ({
  ...jest.requireActual('@/shared/app/NetworkContext'),
  useIsOnline: () => mockOnline,
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());

jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTo: jest.fn(),
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
  ActivityHistoryRow: () => null,
  SettingsNavRow: jest.requireActual('@/features/settings/components/SettingsNavRow')
    .SettingsNavRow,
  OfflineRow: jest.requireActual('@/features/settings/components/OfflineRow').OfflineRow,
  RecordingPermissionSection: () => null,
  settingsStyles: jest.requireActual('@/features/settings/components/settingsStyles')
    .settingsStyles,
  SupportSection: () => null,
  FooterSection: () => null,
}));

const OFFLINE_ROW = 'settings-offline-row';
const ACCOUNT_ROW = 'settings-account-row';

/** The test IDs of the screen's leading rows, in the order they are drawn. */
function leadingRowOrder(tree: unknown): string[] {
  const order: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const el = node as { props?: Record<string, unknown>; children?: unknown };
    const id = el.props?.testID;
    if (typeof id === 'string' && (id === OFFLINE_ROW || id === ACCOUNT_ROW)) {
      order.push(id);
    }
    walk(el.children);
  };
  walk(tree);
  return order;
}

describe('Settings offline row', () => {
  beforeEach(() => {
    mockOnline = true;
    useAuthStore.setState({ authMethod: 'oauth' });
  });

  it('opens on the offline row, above the account card, while the device is offline', async () => {
    mockOnline = false;

    const { getByTestId, toJSON } = await render(<SettingsScreen />);

    expect(getByTestId(OFFLINE_ROW)).toBeTruthy();
    expect(leadingRowOrder(toJSON())).toEqual([OFFLINE_ROW, ACCOUNT_ROW]);
  });

  it('says what still works in the row, under the offline title', async () => {
    mockOnline = false;

    const { getByTestId, getByText } = await render(<SettingsScreen />);

    expect(within(getByTestId(OFFLINE_ROW)).getByText('emptyState.offline.title')).toBeTruthy();
    expect(getByText('settings.offlineRow.detail')).toBeTruthy();
  });

  it('draws no offline row while the device is online', async () => {
    const { queryByTestId, toJSON } = await render(<SettingsScreen />);

    expect(queryByTestId(OFFLINE_ROW)).toBeNull();
    expect(leadingRowOrder(toJSON())).toEqual([ACCOUNT_ROW]);
  });
});
