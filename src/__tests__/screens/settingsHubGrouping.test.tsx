/**
 * Scenario: the hub grouped by subsystem, so the heatmap toggle sat under Sync
 * because that is what fetches it, and an athlete looking for it went to Maps.
 *
 * Expected behaviour: the groups name what the athlete is doing, not which
 * subsystem owns the screen, and every row previews the state of its spoke so
 * the hub answers "what is this set to" without opening anything.
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';

import SettingsScreen from '@/app/settings';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key);
  return { useTranslation: () => ({ t }) };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

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

// The hub reads the job list for the Background Jobs subtitle. What that list
// is computed from belongs to BackgroundJobsPanel's own tests.
let mockJobs: { id: string; state: string }[] = [{ id: 'sync', state: 'idle' }];
jest.mock('@/features/settings', () => ({
  useBackgroundJobs: () => mockJobs,
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

function subtitleOf(screen: ReturnType<typeof render>, testID: string): string {
  const row = screen.getByTestId(testID);
  const lines = within(row).getAllByText(/.+/);
  return String(lines[lines.length - 1].props.children);
}

describe('Settings hub grouping', () => {
  beforeEach(() => {
    mockJobs = [{ id: 'sync', state: 'idle' }];
  });

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
      'settings-nav-background-jobs',
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
      return within(row).getAllByText(/.+/).length < 2;
    });
    expect(bare).toEqual([]);
  });

  it('counts the jobs that are running, and says so when none are', () => {
    expect(subtitleOf(render(<SettingsScreen />), 'settings-nav-background-jobs')).toBe(
      'backgroundJobs.stateIdle'
    );

    mockJobs = [
      { id: 'sync', state: 'running' },
      { id: 'detection', state: 'running' },
      { id: 'cutover', state: 'idle' },
    ];
    expect(subtitleOf(render(<SettingsScreen />), 'settings-nav-background-jobs')).toBe(
      'settings.jobsRunning'
    );
  });
});
