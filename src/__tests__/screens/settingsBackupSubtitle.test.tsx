/**
 * Scenario: the athlete runs a backup, comes back to Settings and the screen
 * re-renders for some other reason.
 *
 * Expected behaviour: the auto-backup row's subtitle shows the new backup date.
 * It was memoised on the translation function alone, so the date it read at
 * mount stood for the life of the screen.
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';

import SettingsScreen from '@/app/settings';
import { getLastBackupTimestamp } from '@/features/settings/lib/autobackup';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

// i18next hands back the same `t` on every render unless the language changes,
// so the stub must too: a fresh function per render invalidates any memo keyed
// on it and hides exactly the staleness this file is about.
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
  getLastBackupTimestamp: jest.fn(),
}));

// The hub reads the job list for the Background Jobs subtitle. What that list
// is computed from belongs to BackgroundJobsPanel's own tests.
jest.mock('@/features/settings', () => ({
  useBackgroundJobs: () => [{ id: 'sync', state: 'idle' }],
}));

jest.mock('@/features/settings/components', () => ({
  SupportSection: () => null,
  FooterSection: () => null,
}));

const readTimestamp = getLastBackupTimestamp as jest.MockedFunction<() => number | null>;

/** The nav row renders its title then its subtitle, so the subtitle is the last line. */
function backupSubtitle(screen: ReturnType<typeof render>): string {
  const row = screen.getByTestId('settings-nav-backup');
  const lines = within(row).getAllByText(/.+/);
  return String(lines[lines.length - 1].props.children);
}

describe('Settings auto-backup subtitle', () => {
  it('says never when no backup has been taken', () => {
    readTimestamp.mockReturnValue(null);
    const screen = render(<SettingsScreen />);
    expect(backupSubtitle(screen)).toBe('backup.lastBackupNever');
  });

  it('shows the date a backup was last taken', () => {
    const taken = Date.UTC(2026, 0, 15, 12);
    readTimestamp.mockReturnValue(taken);
    const screen = render(<SettingsScreen />);
    expect(backupSubtitle(screen)).toBe(new Date(taken).toLocaleDateString());
  });

  it('picks up a backup taken since the screen mounted', () => {
    const first = Date.UTC(2026, 0, 15, 12);
    const second = Date.UTC(2026, 5, 20, 12);
    readTimestamp.mockReturnValue(first);
    const screen = render(<SettingsScreen />);
    expect(backupSubtitle(screen)).toBe(new Date(first).toLocaleDateString());

    readTimestamp.mockReturnValue(second);
    screen.rerender(<SettingsScreen />);
    expect(backupSubtitle(screen)).toBe(new Date(second).toLocaleDateString());
  });

  it('goes back to never if the backup record is cleared', () => {
    readTimestamp.mockReturnValue(Date.UTC(2026, 0, 15, 12));
    const screen = render(<SettingsScreen />);

    readTimestamp.mockReturnValue(null);
    screen.rerender(<SettingsScreen />);
    expect(backupSubtitle(screen)).toBe('backup.lastBackupNever');
  });
});
