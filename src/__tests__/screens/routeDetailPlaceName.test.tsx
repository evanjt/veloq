/**
 * Scenario: the route detail read says whether the athlete may ask for the
 * route to be named from its places, which it says only while geocoding is on
 * and the route has no typed name.
 *
 * Expected behaviour: the button beside the name follows that answer, runs one
 * lookup at a time, and says so when the lookup gives no name.
 */

import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import RouteDetailScreen from '@/app/route/[id]';
import { PlaceNameKind, PlaceNameOutcome } from '../__shared__/veloqrsStub';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [
      { latitude: 46.2, longitude: 7.3 },
      { latitude: 46.3, longitude: 7.4 },
    ],
  })
);
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useIsFocused: () => true,
  Stack: Object.assign(() => null, { Screen: () => null }),
  useLocalSearchParams: () => ({ id: 'r_9' }),
  router: { back: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mockNameFromPlaces = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ setRouteName: jest.fn(), nameFromPlaces: mockNameFromPlaces }),
  isEngineReady: () => true,
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
    Spinner: jest.requireActual('@/shared/ui/Spinner').Spinner,
    Button: jest.requireActual('@/shared/ui/Button').Button,
    DetailHero: ({ overlay }: { overlay: React.ReactNode }) => overlay,
    HeroNameRow: hero.HeroNameRow,
    IconButton: jest.requireActual('@/shared/ui/IconButton').IconButton,
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
  PlaceNameButton: jest.requireActual('@/features/routes/components/PlaceNameButton')
    .PlaceNameButton,
  RouteDetailMap: () => null,
  SportTypeSelector: () =>
    jest.requireActual('react').createElement('Text', { testID: 'sport-type-selector' }),
  RouteDetailDebugPanel: () => null,
  routeDetailScreenStyles: {},
}));

let mockOffered = true;
const mockCanNameFromPlaces = () => mockOffered;
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
      canNameFromPlaces: mockCanNameFromPlaces(),
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

beforeEach(() => {
  mockOffered = true;
  mockNameFromPlaces.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('offers the place name button when the read allows it', async () => {
  const screen = await render(<RouteDetailScreen />);

  expect(screen.getByTestId('route-place-name-button')).toBeTruthy();
});

it('draws no place name button when the read refuses it', async () => {
  mockOffered = false;
  const screen = await render(<RouteDetailScreen />);

  expect(screen.queryByTestId('route-place-name-button')).toBeNull();
});

it('hides the button while the name is being edited', async () => {
  const screen = await render(<RouteDetailScreen />);

  await fireEvent.press(screen.getByTestId('route-rename-button'));

  expect(screen.queryByTestId('route-place-name-button')).toBeNull();
});

it('asks for this route once, however often it is pressed while waiting', async () => {
  let answer: (outcome: PlaceNameOutcome) => void = () => {};
  mockNameFromPlaces.mockReturnValue(new Promise((resolve) => (answer = resolve)));
  const screen = await render(<RouteDetailScreen />);

  void fireEvent.press(screen.getByTestId('route-place-name-button'));
  void fireEvent.press(screen.getByTestId('route-place-name-button'));

  expect(mockNameFromPlaces).toHaveBeenCalledTimes(1);
  expect(mockNameFromPlaces).toHaveBeenCalledWith(PlaceNameKind.Route, 'r_9');
  expect(screen.getByTestId('route-place-name-button').props.accessibilityState).toMatchObject({
    busy: true,
    disabled: true,
  });

  await act(async () => answer(PlaceNameOutcome.Named));

  expect(screen.getByTestId('route-place-name-button').props.accessibilityState).toMatchObject({
    busy: false,
    disabled: false,
  });
  expect(Alert.alert).not.toHaveBeenCalled();
});

it.each([
  [PlaceNameOutcome.NoPlace, 'routes.placeNameNoPlaceMessage'],
  [PlaceNameOutcome.Failed, 'routes.placeNameFailedMessage'],
  [PlaceNameOutcome.Refused, 'routes.placeNameFailedMessage'],
])('says so when the lookup gives no name (%s)', async (outcome, message) => {
  mockNameFromPlaces.mockResolvedValue(outcome);
  const screen = await render(<RouteDetailScreen />);

  await act(async () => await fireEvent.press(screen.getByTestId('route-place-name-button')));

  expect(Alert.alert).toHaveBeenCalledWith(
    'routes.placeNameFailedTitle',
    message,
    undefined,
    expect.objectContaining({ cancelable: true })
  );
  expect(screen.getByTestId('route-detail-name').props.children).toBe('Strecke 4');
});

it('says so when the lookup throws', async () => {
  mockNameFromPlaces.mockRejectedValue(new Error('engine closed'));
  const screen = await render(<RouteDetailScreen />);

  await act(async () => await fireEvent.press(screen.getByTestId('route-place-name-button')));

  expect(Alert.alert).toHaveBeenCalledWith(
    'routes.placeNameFailedTitle',
    'routes.placeNameFailedMessage',
    undefined,
    expect.objectContaining({ cancelable: true })
  );
});
