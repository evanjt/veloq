import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import RouteDetailScreen from '@/app/route/[id]';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: 'r_1' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/native/engine', () => ({ isEngineReady: () => true }));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/features/settings', () => ({
  useDebugStore: (select: (state: { enabled: boolean }) => unknown) => select({ enabled: false }),
  useGpxExport: () => ({ exportGpx: jest.fn(), exporting: false }),
}));
jest.mock('@/shared/debug/useFFITimer', () => ({
  useFFITimer: () => ({ getPageMetrics: () => [] }),
}));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));
jest.mock('@/shared/ui', () => ({
  pressable: (style: unknown) => style,
  pressRipple: undefined,
  DetailHero: ({ children }: { children: React.ReactNode }) => children,
  HeroNameRow: () => null,
  HeroStatsRow: () => null,
  useHeroMapHeight: () => 300,
}));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (component: unknown) => component,
}));
jest.mock('@/features/routes/components/section', () => ({
  PerformanceChartPanel: ({ chartData }: { chartData: unknown[] }) => {
    const { View } = require('react-native');
    return <View testID="attempt-chart" accessibilityValue={{ text: String(chartData.length) }} />;
  },
}));
jest.mock('@/features/routes/components', () => ({
  DataRangeFooter: () => null,
  DetailFallback: () => null,
  RouteDetailMap: () => null,
  SportTypeSelector: () => null,
  RouteDetailChart: jest.requireActual('@/features/routes/components/RouteDetailChart')
    .RouteDetailChart,
  RouteDetailDebugPanel: () => null,
  routeDetailScreenStyles: {},
}));
jest.mock('@/features/routes/hooks', () => ({
  useRoutePerformances: () => ({ performances: [], best: null, trendCurves: {} }),
  useSportTypeFilter: () => ({
    selectedSportType: null,
    setSelectedSportType: jest.fn(),
    availableSportTypes: [],
    sportFilter: undefined,
  }),
  useRouteChartData: (_performances: unknown, _group: unknown, excludedChartData: unknown[]) => ({
    signatures: {},
    chartData: excludedChartData,
  }),
  useRouteReference: () => ({ effectiveRepresentativeId: 'a1', handleSetAsReference: jest.fn() }),
  useRouteRenaming: () => ({ customName: null }),
  useExcludedActivities: () => {
    const [showExcluded, setShowExcluded] = require('react').useState(false);
    return {
      showExcluded,
      excludedActivityIds: new Set(['a1', 'a2']),
      handleExcludeActivity: jest.fn(),
      handleIncludeActivity: jest.fn(),
      handleToggleShowExcluded: () => setShowExcluded((shown: boolean) => !shown),
      excludedChartData: showExcluded
        ? [
            { id: 'a1', x: 0 },
            { id: 'a2', x: 1 },
          ]
        : [],
    };
  },
}));
jest.mock('@/features/routes', () => ({
  ...jest.requireMock('@/features/routes/components'),
  ...jest.requireMock('@/features/routes/hooks'),
  useRouteDetailData: () => ({
    status: { kind: 'ok' },
    data: {
      group: {
        groupId: 'r_1',
        representativeId: 'a1',
        activityIds: ['a1', 'a2'],
        activityCount: 2,
        sportType: 'Ride',
        sportTypes: ['Ride'],
      },
      groups: [],
      activityCount: 2,
      performances: { activityMetrics: [] },
      excludedActivityIds: ['a1', 'a2'],
      mapSignatures: [],
    },
  }),
  buildRouteGroupBase: () => ({ groupId: 'r_1', name: 'Canal Loop', activityCount: 2 }),
  buildFinalRouteGroup: (group: unknown) => group,
  routeHeadline: () => ({ distance: 1000, lastDate: null }),
  createMapHighlightStore: () => ({ set: jest.fn() }),
  toActivityType: () => 'Ride',
}));

it('keeps the eye available when every attempt is excluded and restores the chart', () => {
  const screen = render(<RouteDetailScreen />);

  expect(screen.getByTestId('route-detail-chart')).toBeTruthy();
  expect(screen.getByTestId('route-detail-chart-empty')).toBeTruthy();
  expect(screen.queryByTestId('attempt-chart')).toBeNull();

  fireEvent.press(screen.getByRole('button', { name: 'sections.showExcludedActivities' }));

  expect(screen.getByTestId('attempt-chart').props.accessibilityValue.text).toBe('2');
});
