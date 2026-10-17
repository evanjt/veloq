/**
 * Scenario: the routes tab of the insights screen, whose list refreshes on a
 * pull and spins while the track work runs.
 *
 * Expected behaviour: a pull asks the engine to sync, and the spinner follows
 * the track work the engine reports, including a pass it started by itself
 * after the sync settled.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import InsightsScreen from '@/app/(tabs)/insights';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: require('../__shared__/nativeHeaderStandIn').Stack,
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ tab: 'routes' }),
  router: { push: jest.fn(), setParams: jest.fn() },
}));
jest.mock('@/shared/ui', () => ({
  IconButton: jest.requireActual('@/shared/ui/IconButton').IconButton,
  ScreenErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
  ScreenSafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  SwipeableTabs: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/features/insights', () => ({
  aboutInsightsBody: jest.fn(),
  InsightsPanel: () => null,
  StrengthTab: () => null,
  useInsights: () => ({ insights: [], markAsSeen: jest.fn() }),
}));
jest.mock('@/features/activity', () => ({
  useActivityBoundsCache: () => ({ sync: jest.fn() }),
}));
jest.mock('@/features/routes/components/RoutesList', () => ({
  RoutesList: ({ onRefresh, isRefreshing }: { onRefresh: () => void; isRefreshing: boolean }) => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return React.createElement(
      Pressable,
      { testID: 'routes-refresh', onPress: onRefresh },
      React.createElement(Text, null, isRefreshing ? 'Refreshing routes' : 'Refresh routes')
    );
  },
}));
let mockTrackStage: unknown = null;
jest.mock('@/shared/native/useSyncStatus', () => ({
  useTrackStage: () => mockTrackStage,
}));
jest.mock('@/features/routes/components/SectionsList', () => ({ SectionsList: () => null }));
jest.mock('@/features/routes/components/DateRangeSummary', () => ({
  DateRangeSummary: () => null,
}));
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useSectionCommands: () => ({ removeSection: jest.fn() }),
}));
jest.mock('@/features/routes/hooks/useRoutesScreenData', () => ({
  useRoutesScreenData: () => ({ data: { groups: [], activityCount: 0 } }),
}));
jest.mock('@/features/strength', () => ({
  useStrengthTabState: () => 'hidden',
  strengthPeriodOf: () => null,
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/useUserLocation', () => ({
  useUserLocation: () => ({ location: null, requestPermission: jest.fn() }),
}));
jest.mock('@/features/routes/stores/EngineStatusStore', () => ({
  useEngineStatus: (select: (state: object) => unknown) =>
    select({
      initFailed: false,
    }),
}));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  useRouteSettings: (select: (state: object) => unknown) => select({ settings: { enabled: true } }),
}));
jest.mock('@/features/settings/stores/DebugStore', () => ({
  useDebugStore: (select: (state: object) => unknown) => select({ enabled: false }),
}));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (select: (state: object) => unknown) =>
    select({
      oldest: null,
      newest: null,
      extendedFetch: { phase: 'idle' },
    }),
}));
jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => jest.fn() }));

it('asks the engine to sync when the routes list refreshes', async () => {
  await render(<InsightsScreen />);

  await fireEvent.press(screen.getByTestId('routes-refresh'));

  expect(requestSyncRefresh).toHaveBeenCalledTimes(1);
});

it('spins the list while the engine reports a GPS pass, and only then', async () => {
  const { TrackStep } = require('../__shared__/veloqrsStub');
  mockTrackStage = { step: TrackStep.Downloading, completed: 2, total: 9, percent: 22 };
  const during = await render(<InsightsScreen />);
  expect(screen.getByText('Refreshing routes')).toBeTruthy();
  await during.unmount();

  mockTrackStage = null;
  await render(<InsightsScreen />);
  expect(screen.getByText('Refresh routes')).toBeTruthy();
  expect(screen.queryByText('Refreshing routes')).toBeNull();
});
