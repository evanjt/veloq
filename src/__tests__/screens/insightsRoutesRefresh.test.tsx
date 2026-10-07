import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import InsightsScreen from '@/app/(tabs)/insights';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ tab: 'routes' }),
  router: { push: jest.fn(), setParams: jest.fn() },
}));
jest.mock('@/shared/ui', () => ({
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
  RoutesList: ({ onRefresh }: { onRefresh: () => void }) => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return React.createElement(
      Pressable,
      { testID: 'routes-refresh', onPress: onRefresh },
      React.createElement(Text, null, 'Refresh routes')
    );
  },
}));
jest.mock('@/features/routes/components/SectionsList', () => ({ SectionsList: () => null }));
jest.mock('@/features/routes/components/DateRangeSummary', () => ({
  DateRangeSummary: () => null,
}));
jest.mock('@/features/routes/components/SyncDebugTab', () => ({ SyncDebugTab: () => null }));
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useCustomSections: () => ({ count: 0 }),
}));
jest.mock('@/features/routes/hooks/useRoutesScreenData', () => ({
  useRoutesScreenData: () => ({ data: { groups: [], activityCount: 0 } }),
}));
jest.mock('@/features/strength', () => ({ useStrengthTabState: () => 'hidden' }));
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
      gpsSyncProgress: { status: 'idle' },
      isGpsSyncing: false,
    }),
}));
jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => jest.fn() }));

it('asks the engine to sync when the routes list refreshes', () => {
  render(<InsightsScreen />);

  fireEvent.press(screen.getByTestId('routes-refresh'));

  expect(requestSyncRefresh).toHaveBeenCalledTimes(1);
});
