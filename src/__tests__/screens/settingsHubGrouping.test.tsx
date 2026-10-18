/**
 * Scenario: the hub grouped by subsystem, so the heatmap toggle sat under Sync
 * because that is what fetches it, and an athlete looking for it went to Maps.
 *
 * Expected behaviour: the groups name what the athlete is doing, not which
 * subsystem owns the screen, no group holds a single row, and every row
 * previews the state of its spoke so the hub answers "what is this set to"
 * without opening anything. A row is titled as the screen it opens is.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import SettingsScreen from '@/app/(tabs)/settings';
import { SCREEN_HEADERS } from '@/shared/app/screenHeaders';
import { spacing } from '@/theme';

const mockNavigateTo = jest.fn();
jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTo: (...a: unknown[]) => mockNavigateTo(...a),
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useSegments: () => ['settings'],
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'outdoors', terrain3DMode: 'off' },
  }),
}));

jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ athlete: null }) }));

jest.mock('@/shared/storage/gpsStorage', () => ({
  getAppStorageSize: jest.fn().mockResolvedValue(0),
}));

jest.mock('@/features/settings/lib/autobackup', () => ({
  getLastBackupTimestamp: jest.fn().mockReturnValue(null),
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

/**
 * Every group heading and every row, in the order they render. A row placed
 * under the wrong heading moves in this list, which a per-row lookup would
 * not catch.
 */
function inRenderOrder(tree: unknown): string[] {
  const found: string[] = [];
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
    if (typeof id === 'string' && /^settings-(group|nav)-/.test(id)) {
      found.push(id);
    }
    walk(el.children);
  };
  walk(tree);
  return found;
}

describe('Settings hub grouping', () => {
  it('groups the rows by what the athlete is doing', async () => {
    const screen = await render(<SettingsScreen />);

    expect(inRenderOrder(screen.toJSON())).toEqual([
      'settings-group-shows',
      'settings-nav-display',
      'settings-nav-maps',
      'settings-nav-summary-card',
      'settings-group-collects',
      'settings-nav-sync',
      'settings-nav-recording',
      'settings-nav-sensors',
      'settings-nav-notifications',
      'settings-nav-data-sources',
      'settings-group-keeps',
      'settings-nav-detection',
      'settings-nav-backup',
      'settings-nav-cache',
    ]);
  });

  it('titles every row as the header of the screen it opens', async () => {
    const screen = await render(<SettingsScreen />);
    const rows = inRenderOrder(screen.toJSON()).filter((id) => id.startsWith('settings-nav-'));

    const mismatched = rows.flatMap((id) => {
      mockNavigateTo.mockClear();
      const row = screen.getByTestId(id);
      fireEvent.press(row);
      const route = String(mockNavigateTo.mock.calls[0]?.[0]).replace(/^\//, '');
      const rowTitle = row.findAllByType(Text)[0].props.children;
      // The suite's translator answers a bare key with the key itself.
      const headerTitle = SCREEN_HEADERS[route]?.titleKey;
      return rowTitle === headerTitle ? [] : [{ id, rowTitle, headerTitle }];
    });
    expect(mismatched).toEqual([]);
  });

  it('gives every spoke a subtitle, so a new row cannot arrive bare', async () => {
    const screen = await render(<SettingsScreen />);
    // Data sources is attribution and carries no preference of its own.
    const spokes = inRenderOrder(screen.toJSON()).filter(
      (id) => id.startsWith('settings-nav-') && id !== 'settings-nav-data-sources'
    );

    const bare = spokes.filter((id) => {
      const row = screen.getByTestId(id);
      return row.findAllByType(Text).length < 2;
    });
    expect(bare).toEqual([]);
  });

  it('ends the list at its own spacing, with no tab bar to clear on a stack screen', async () => {
    const screen = await render(<SettingsScreen />);
    const content = screen.getByTestId('settings-scrollview').props.contentContainerStyle;

    expect(StyleSheet.flatten(content).paddingBottom).toBe(spacing.xl);
  });
});
