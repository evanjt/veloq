/**
 * Scenario: the route detail screen opens on a route the athlete never named,
 * which the engine hands over under its number in the current language.
 *
 * Expected behaviour: the hero name, the navigation title, the rename field and
 * the GPX export all read that label, and the group id appears nowhere.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { routeCardInHost } from '../__shared__/routeCardInHost';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [
      { latitude: 46.2, longitude: 7.3 },
      { latitude: 46.3, longitude: 7.4 },
    ],
  })
);
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
// The options each `Stack.Screen` the screen renders hands its navigation item, merged in order.
let mockScreenOptions: Record<string, unknown> = {};
jest.mock('expo-router', () => {
  function Stack() {
    return null;
  }
  Stack.Screen = function Screen({ options }: { options?: Record<string, unknown> }) {
    mockScreenOptions = { ...mockScreenOptions, ...options };
    return null;
  };
  return {
    ...jest.requireActual('expo-router'),
    useIsFocused: () => true,
    useLocalSearchParams: () => ({ id: 'r_9' }),
    router: { back: jest.fn() },
    Stack,
  };
});
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ setRouteName: jest.fn() }),
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/features/settings/stores/DebugStore', () => ({
  useDebugStore: (select: (s: { enabled: boolean }) => unknown) => select({ enabled: false }),
}));
jest.mock('@/shared/debug/useFFITimer', () => ({
  useFFITimer: () => ({ getPageMetrics: () => [] }),
}));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));

const mockExportGpx = jest.fn();
jest.mock('@/features/settings/hooks/exportIndex', () => ({
  useGpxExport: () => ({ exportGpx: mockExportGpx, exporting: false }),
}));

jest.mock('@/shared/ui', () => {
  const hero = jest.requireActual('@/shared/ui/DetailHero');
  return {
    Button: jest.requireActual('@/shared/ui/Button').Button,
    DetailHero: ({ overlay }: { overlay: React.ReactNode }) => overlay,
    HeroNameRow: hero.HeroNameRow,
    HeroStatsRow: () => null,
    ScreenErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    useHeroMapHeight: () => 300,
    useBottomClearance: () => 0,
    useScrollEndInset: () => 0,
  };
});

jest.mock('@/features/routes/components', () => ({
  DataRangeFooter: () => null,
  DetailFallback: () => null,
  RouteDetailMap: () => null,
  SportTypeSelector: () =>
    jest.requireActual('react').createElement('Text', { testID: 'sport-type-selector' }),
  RouteDetailDebugPanel: () => null,
  routeDetailScreenStyles: {},
}));

jest.mock('@/features/routes/hooks/useRouteDetailData', () => ({
  useRouteDetailData: () => ({
    status: { kind: 'ok' },
    data: {
      group: {
        groupId: 'r_9',
        representativeId: 'a1',
        activityIds: ['a1', 'a2'],
        activityCount: 2,
        sportType: '',
        sportTypes: ['Ride'],
        customName: 'Strecke 4',
      },
      activityCount: 2,
      encodedRepresentative: new ArrayBuffer(8),
      excludedActivityIds: [],
      mapSignatures: [],
      missingTimeStreamIds: [],
    },
  }),
}));
jest.mock('@/features/routes/components/section/SectionPerformanceSection', () => ({
  ...jest.requireActual('@/features/routes/components/section/SectionPerformanceSection'),
  SectionPerformanceSection: () => null,
}));
jest.mock('@/features/routes/hooks/useSectionDetailData', () => ({
  useRouteDetailPerformance: () => ({
    data: {
      sportType: 'Ride',
      sportCounts: [{ sportType: 'Ride', count: 2 }],
      performances: { records: [], bestForwardIsPr: false, bestReverseIsPr: false },
      chartData: { points: [], minSpeed: 0, maxSpeed: 0, hasReverseRuns: false },
      excludedPoints: [],
      lapRecords: [],
      bestForwardIsRecord: false,
      bestReverseIsRecord: false,
      trendCurves: {},
      histograms: {},
      correlations: [],
      correlationFloor: 0,
    },
    error: undefined,
  }),
}));
jest.mock('@/features/routes/hooks', () => ({
  ...jest.requireActual('@/features/routes/hooks/useRouteRenaming'),
  ...jest.requireActual('@/features/routes/hooks/useSectionChartData'),
  ...jest.requireActual('@/features/routes/hooks/useSectionChartDataEnriched'),
  useRouteMapSignatures: () => ({}),
  useSectionTimeStreamSync: () => ({
    ready: true,
    isFetching: false,
    error: null,
    refetch: jest.fn(),
  }),
  useRouteReference: () => ({ effectiveRepresentativeId: 'a1', handleSetAsReference: jest.fn() }),
  useExcludedActivities: () => ({
    showExcluded: false,
    handleExcludeActivity: jest.fn(),
    handleIncludeActivity: jest.fn(),
    handleToggleShowExcluded: jest.fn(),
  }),
}));

const RouteDetailScreen = routeCardInHost((options) => {
  mockScreenOptions = { ...mockScreenOptions, ...options };
});

beforeEach(() => {
  jest.useFakeTimers();
  mockExportGpx.mockClear();
  mockScreenOptions = {};
});

afterEach(() => {
  jest.useRealTimers();
});

it('titles the header with the numbered label, not the group id', async () => {
  const screen = await render(<RouteDetailScreen />);

  expect(screen.getByTestId('route-detail-name').props.children).toBe('Strecke 4');
  expect(screen.queryByText('r_9')).toBeNull();
});

it('titles the navigation item with the numbered label and marks the hero name a heading', async () => {
  const screen = await render(<RouteDetailScreen />);

  expect(mockScreenOptions.title).toBe('Strecke 4');
  expect(screen.getByRole('header', { name: 'Strecke 4' })).toBeTruthy();
});

it('opens the rename field on the numbered label', async () => {
  const screen = await render(<RouteDetailScreen />);

  await fireEvent.press(screen.getByTestId('route-rename-button'));

  expect(screen.getByTestId('route-rename-input').props.value).toBe('Strecke 4');
});

it('names the GPX export with the numbered label', async () => {
  const screen = await render(<RouteDetailScreen />);

  await fireEvent.press(screen.getByTestId('route-export-gpx'));

  expect(mockExportGpx).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Strecke 4', sport: 'Ride' })
  );
});
