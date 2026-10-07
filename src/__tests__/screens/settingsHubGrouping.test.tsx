/**
 * Scenario: the hub grouped by subsystem, so the heatmap toggle sat under Sync
 * because that is what fetches it, and an athlete looking for it went to Maps.
 *
 * Expected behaviour: the groups name what the athlete is doing, not which
 * subsystem owns the screen, and every row previews the state of its spoke so
 * the hub answers "what is this set to" without opening anything.
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import SettingsScreen from '@/app/settings';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
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
  it('groups the rows by what the athlete is doing', () => {
    const screen = render(<SettingsScreen />);

    expect(inRenderOrder(screen.toJSON())).toEqual([
      'settings-group-shows',
      'settings-nav-display',
      'settings-nav-maps',
      'settings-nav-summary-card',
      'settings-group-collects',
      'settings-nav-sync',
      'settings-nav-recording',
      'settings-nav-sensors',
      'settings-group-keeps',
      'settings-nav-detection',
      'settings-nav-backup',
      'settings-nav-cache',
      'settings-group-tells',
      'settings-nav-notifications',
      'settings-nav-data-sources',
    ]);
  });

  it('gives every spoke a subtitle, so a new row cannot arrive bare', () => {
    const screen = render(<SettingsScreen />);
    // The footer link is not a spoke and carries no preference of its own.
    const spokes = inRenderOrder(screen.toJSON()).filter(
      (id) => id.startsWith('settings-nav-') && id !== 'settings-nav-data-sources'
    );

    const bare = spokes.filter((id) => {
      const row = screen.getByTestId(id);
      return row.findAllByType(Text).length < 2;
    });
    expect(bare).toEqual([]);
  });
});
