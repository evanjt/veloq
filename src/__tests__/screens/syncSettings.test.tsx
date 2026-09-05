import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import SyncSettingsScreen from '@/app/sync-settings';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../__shared__/veloqrsStub').withOverrides()
);

/**
 * Scenario: sync settings carries one job's own row, and the jobs area is
 * where all four live. A screen already carrying a job points at that area
 * rather than being the only place the work is visible.
 *
 * Expected behaviour: the screen keeps its own sync row and offers the way in,
 * and the link says nothing about the job's state, which the row above it
 * already shows.
 */

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: mockPassthrough,
  SafeAreaView: mockPassthrough,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

// Hoisted past the mock factories as declarations, so they can reach `View`
// without a `require` inside the factory.
function mockPassthrough({ children }: { children?: React.ReactNode }) {
  return React.createElement(View, null, children);
}
function mockJobsLink() {
  return React.createElement(View, { testID: 'background-jobs-link' });
}
function mockSyncRow() {
  return React.createElement(View, { testID: 'activity-sync-row' });
}
function mockRangePanel() {
  return React.createElement(View, { testID: 'sync-range-panel' });
}

jest.mock('@/features/settings/components', () => ({
  BackgroundJobsLink: mockJobsLink,
  ActivitySyncRow: mockSyncRow,
  SyncRangePanel: mockRangePanel,
}));

describe('SyncSettingsScreen', () => {
  it('links out to the jobs area, so sync is not the only job with a home', () => {
    const tree = render(<SyncSettingsScreen />);

    expect(tree.getByTestId('background-jobs-link')).toBeTruthy();
  });

  it('keeps its own sync row, which the link does not replace', () => {
    const tree = render(<SyncSettingsScreen />);

    expect(tree.getByTestId('activity-sync-row')).toBeTruthy();
    expect(tree.getByTestId('sync-range-panel')).toBeTruthy();
  });
});
