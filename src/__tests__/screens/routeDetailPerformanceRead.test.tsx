/**
 * Scenario: the route page answers one sport and one range at a time from the
 * route performance read, the way the section page reads its own.
 *
 * Expected behaviour: opening the route makes that read once over every date
 * and the engine's default sport, the range chips and one sport pill per sport
 * the read counts are on screen, a chip re-reads at its range, the efficiency
 * card draws the trend the read carries for the sport on screen, and the
 * per-sport and excluded-attempt reads the page used to make are never made.
 * Below the chart the summary, calendar and wellness cards are drawn from the
 * same read, and the summary's First is the read's oldest attempt.
 */

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import RouteDetailScreen from '@/app/route/[id]';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    FfiCorrelation_Tags: {
      TooFew: 'TooFew',
      Undefined: 'Undefined',
      Inconclusive: 'Inconclusive',
      Mover: 'Mover',
    },
  })
);
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: 'grp-heath' }),
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/shared/debug/renderTimer', () => ({
  logScreenRender: () => () => {},
  recordAppMetric: () => {},
}));
jest.mock('@/shared/debug/useFFITimer', () => ({
  useFFITimer: () => ({ getPageMetrics: () => [] }),
}));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (component: unknown) => component,
}));
jest.mock('@/features/settings', () => ({
  useDebugStore: (select: (state: { enabled: boolean }) => unknown) => select({ enabled: false }),
  useGpxExport: () => ({ exportGpx: jest.fn(), exporting: false }),
}));
jest.mock('@/features/routes/components/RouteDetailMap', () => ({ RouteDetailMap: () => null }));
jest.mock('@/features/routes/components/section/PerformanceChartPanel', () => ({
  PerformanceChartPanel: ({
    chartData,
    hasExcluded,
    onToggleShowExcluded,
    onExcludeActivity,
  }: {
    chartData: { activityId: string }[];
    hasExcluded?: boolean;
    onToggleShowExcluded?: () => void;
    onExcludeActivity?: (activityId: string) => void;
  }) => {
    const { Pressable, View } = require('react-native');
    return (
      <View testID="attempt-chart" accessibilityValue={{ text: String(chartData.length) }}>
        <Pressable
          testID="exclude-first-attempt"
          onPress={() => onExcludeActivity?.(chartData[0].activityId)}
        />
        {hasExcluded ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="sections.showExcludedActivities"
            onPress={onToggleShowExcluded}
          />
        ) : null}
      </View>
    );
  },
}));

type SportCount = { sportType: string; count: number };

const efficiencyPoint = (date: number, ratio: number) => ({
  date,
  paceSecsPerKm: 300,
  avgHr: 150,
  hrPaceRatio: ratio,
});

/** The read's trend per sport: the rides carry heart rate, the runs too few. */
const mockEfficiencyTrends: Record<string, unknown> = {
  Ride: {
    sectionId: 'grp-heath',
    sectionName: 'Heath Loop',
    sportType: 'Ride',
    points: [efficiencyPoint(1, 450), efficiencyPoint(2, 440), efficiencyPoint(3, 430)],
    trendSlope: -10,
    direction: 1,
    hrChangeBpm: -4,
    effortCount: 3,
  },
};

const point = (id: string, sport: string) => ({
  lapId: id,
  activityId: id,
  activityName: `${sport} ${id}`,
  activityDate: 1_780_000_000,
  speed: 5,
  sectionTime: 600,
  sectionDistance: 3000,
  direction: 'same',
  isBest: false,
  outsideDistanceBand: false,
  matchPercentage: 92,
});

function performanceRead(sportCounts: SportCount[], sport: string | undefined) {
  const shown = sport ?? sportCounts[0]?.sportType;
  return {
    sportType: shown,
    sportCounts,
    performances: {
      records: [],
      bestForwardIsPr: false,
      bestReverseIsPr: false,
    },
    chartData: {
      points: mockCounted
        ? [point(`${shown}-1`, shown ?? ''), point(`${shown}-2`, shown ?? '')]
        : [],
      minSpeed: 5,
      maxSpeed: 5,
      hasReverseRuns: false,
      totalActivities: 2,
    },
    excludedPoints: [point('h3', shown ?? '')],
    lapRecords: [],
    bestForwardIsRecord: false,
    bestReverseIsRecord: false,
    trendCurves: {},
    histograms: {},
    correlations: [],
    correlationFloor: 0,
    ...mockBelowChart,
    efficiencyTrend: shown ? mockEfficiencyTrends[shown] : undefined,
  };
}

let mockSportCounts: SportCount[] = [];
let mockCounted = true;
let mockBelowChart: Record<string, unknown> = {};

const mockEngine = {
  subscribe: () => () => {},
  getRouteDetailData: jest.fn(() => ({
    group: {
      groupId: 'grp-heath',
      representativeId: 'h1',
      activityIds: ['h1', 'h2', 'h3'],
      activityCount: 3,
      sportType: 'Ride',
      sportTypes: mockSportCounts.map((c) => c.sportType),
      customName: 'Heath Loop',
    },
    groups: [],
    activityCount: 3,
    distanceMeters: 3000,
    elevationGainMeters: 236,
    performances: { performances: [], activityMetrics: [] },
    routeNames: {},
    excludedActivityIds: ['h3'],
    mapSignatures: [],
    missingTimeStreamIds: [],
  })),
  getRouteDetailPerformance: jest.fn((_group: string, _days: number, sport?: string) =>
    performanceRead(mockSportCounts, sport)
  ),
  getRoutePerformances: jest.fn(),
  getAllMapSignatures: jest.fn(() => []),
  getAllRouteNames: jest.fn(() => ({})),
  excludeActivityFromRoute: jest.fn(),
  includeActivityInRoute: jest.fn(),
  setRouteRepresentative: jest.fn(),
  resetRouteRepresentative: jest.fn(),
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  isEngineReady: () => true,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCounted = true;
  mockBelowChart = {};
});

describe('route page on a route ridden and run', () => {
  beforeEach(() => {
    mockSportCounts = [
      { sportType: 'Ride', count: 2 },
      { sportType: 'Run', count: 1 },
    ];
  });

  it('states the attempts in the sport on screen and the climbing in the hero', () => {
    const screen = render(<RouteDetailScreen />);

    const stats = screen.getByTestId('route-detail-stats');
    expect(stats).toHaveTextContent('maps.activitiesCount · activityTypes.Ride', { exact: false });
    expect(stats).toHaveTextContent('774 ft', { exact: false });

    fireEvent.press(screen.getByRole('button', { name: 'activityTypes.Run' }));

    expect(screen.getByTestId('route-detail-stats')).toHaveTextContent(
      'maps.activitiesCount · activityTypes.Run',
      { exact: false }
    );
  });

  it('reads the route performance read once over every date and the default sport', () => {
    render(<RouteDetailScreen />);

    expect(mockEngine.getRouteDetailPerformance).toHaveBeenCalledTimes(1);
    expect(mockEngine.getRouteDetailPerformance).toHaveBeenCalledWith('grp-heath', 0, undefined);
  });

  it('offers the range chips and one pill per sport the read counts', () => {
    const screen = render(<RouteDetailScreen />);

    for (const range of ['1m', '3m', '6m', '1y', 'all']) {
      expect(screen.getByTestId(`section-time-range-${range}`)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'activityTypes.Ride' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'activityTypes.Run' })).toBeTruthy();
    expect(screen.getByTestId('attempt-chart').props.accessibilityValue.text).toBe('2');
  });

  it('re-reads at ninety days when the three-month chip is tapped', () => {
    const screen = render(<RouteDetailScreen />);

    fireEvent.press(screen.getByTestId('section-time-range-3m'));

    expect(mockEngine.getRouteDetailPerformance).toHaveBeenLastCalledWith(
      'grp-heath',
      90,
      undefined
    );
  });

  it('re-reads for a sport when its pill is tapped and hands it back on a second tap', () => {
    const screen = render(<RouteDetailScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'activityTypes.Run' }));
    expect(mockEngine.getRouteDetailPerformance).toHaveBeenLastCalledWith('grp-heath', 0, 'Run');

    fireEvent.press(screen.getByRole('button', { name: 'activityTypes.Run' }));
    expect(mockEngine.getRouteDetailPerformance).toHaveBeenLastCalledWith(
      'grp-heath',
      0,
      undefined
    );
  });

  it('draws the efficiency card from the read, for the sport on screen', () => {
    const screen = render(<RouteDetailScreen />);

    expect(screen.getByTestId('section-efficiency-card')).toBeTruthy();
    expect(screen.getByTestId('section-efficiency-detail').props.children).toContain(
      'sections.aerobicEfficiencyDetail'
    );

    fireEvent.press(screen.getByRole('button', { name: 'activityTypes.Run' }));

    expect(screen.queryByTestId('section-efficiency-card')).toBeNull();
  });

  it('never makes the per-sport read, showing excluded attempts included', () => {
    const screen = render(<RouteDetailScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'activityTypes.Run' }));
    fireEvent.press(screen.getByRole('button', { name: 'sections.showExcludedActivities' }));

    expect(mockEngine.getRoutePerformances).not.toHaveBeenCalled();
  });
});

describe('route page on a route of one sport', () => {
  beforeEach(() => {
    mockSportCounts = [{ sportType: 'Ride', count: 3 }];
  });

  it('gives the bare count over every date and names the range once one is picked', () => {
    const screen = render(<RouteDetailScreen />);

    expect(screen.getByTestId('route-detail-stats')).toHaveTextContent(
      '1.9 mi·maps.activitiesCount·774 ft'
    );

    fireEvent.press(screen.getByTestId('section-time-range-3m'));

    expect(screen.getByTestId('route-detail-stats')).toHaveTextContent(
      '1.9 mi·maps.activitiesCount · period.long.3m·774 ft'
    );
  });

  it('shows the one pill', () => {
    const screen = render(<RouteDetailScreen />);

    expect(screen.getAllByRole('button', { name: /^activityTypes\./ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'activityTypes.Ride' })).toBeTruthy();
  });
});

describe('route page after an exclusion', () => {
  beforeEach(() => {
    mockSportCounts = [{ sportType: 'Ride', count: 3 }];
  });

  it('re-reads the attempts once the exclusion is written', () => {
    const screen = render(<RouteDetailScreen />);
    const before = mockEngine.getRouteDetailPerformance.mock.calls.length;

    fireEvent.press(screen.getByTestId('exclude-first-attempt'));

    expect(mockEngine.excludeActivityFromRoute).toHaveBeenCalledWith('grp-heath', 'Ride-1');
    expect(mockEngine.getRouteDetailPerformance.mock.calls.length).toBe(before + 1);
  });

  it('keeps the eye when every attempt is excluded and draws them when it is pressed', () => {
    mockCounted = false;
    const screen = render(<RouteDetailScreen />);

    expect(screen.getByTestId('section-performance-empty')).toBeTruthy();
    expect(screen.queryByTestId('attempt-chart')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'sections.showExcludedActivities' }));

    expect(screen.getByTestId('attempt-chart').props.accessibilityValue.text).toBe('1');
  });
});

describe('route page when the read fails', () => {
  it('says the read failed rather than drawing a route with no attempts', () => {
    mockSportCounts = [{ sportType: 'Ride', count: 3 }];
    mockEngine.getRouteDetailPerformance.mockImplementationOnce(() => {
      throw new Error('engine down');
    });

    const screen = render(<RouteDetailScreen />);

    expect(screen.getByTestId('route-performance-failure')).toBeTruthy();
  });
});

const yearBest = (id: string) => ({
  count: 1,
  bestTime: 600,
  bestPace: 5,
  bestActivityId: id,
  bestActivityName: id,
});

/** 2024-01-15, older than any attempt the chart draws. */
const OLDEST_ATTEMPT = 1_705_276_800;

describe('route page below the chart', () => {
  beforeEach(() => {
    mockSportCounts = [{ sportType: 'Ride', count: 3 }];
    mockBelowChart = {
      chartData: {
        points: [point('h1', 'Ride'), point('h2', 'Ride')],
        minSpeed: 5,
        maxSpeed: 5,
        hasReverseRuns: false,
        firstActivityDate: OLDEST_ATTEMPT,
        lastActivityDate: 1_780_000_000,
        totalActivities: 2,
      },
      calendarSummary: {
        years: [
          {
            year: 2026,
            traversalCount: 1,
            activityCount: 1,
            forward: yearBest('h2'),
            months: [{ month: 5, traversalCount: 1, activityCount: 1, forward: yearBest('h2') }],
          },
          {
            year: 2025,
            traversalCount: 1,
            activityCount: 1,
            forward: yearBest('h1'),
            months: [{ month: 7, traversalCount: 1, activityCount: 1, forward: yearBest('h1') }],
          },
        ],
        forwardPr: yearBest('h2'),
        sectionDistance: 3000,
      },
      correlations: [
        {
          direction: 'same',
          variable: 'sleep',
          result: { tag: 'TooFew', inner: { n: 2 } },
          familySize: 0,
        },
      ],
      correlationFloor: 8,
    };
  });

  it('shows the summary with the oldest attempt in the read as First', () => {
    const screen = render(<RouteDetailScreen />);

    expect(screen.getByTestId('section-first')).toHaveTextContent(/'24/);
    expect(screen.getByTestId('section-last')).toHaveTextContent(/'26/);
  });

  it('shows the calendar with both years and the wellness card', () => {
    const screen = render(<RouteDetailScreen />);

    expect(screen.getByTestId('section-calendar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'stats.year 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'stats.year 2025' })).toBeTruthy();
    expect(screen.getByTestId('section-correlation-card')).toBeTruthy();
    expect(screen.getByTestId('section-correlation-collapsed-same')).toBeTruthy();
  });

  it('sets the route reference from a calendar month best', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<RouteDetailScreen />);

    fireEvent.press(screen.getAllByTestId('calendar-reference-button')[0]);
    const confirm = alert.mock.calls[0][2]?.find((button) => button.text === 'common.confirm');
    confirm?.onPress?.();

    expect(alert).toHaveBeenCalledWith(
      'routes.setAsReference',
      expect.anything(),
      expect.anything()
    );
    expect(mockEngine.setRouteRepresentative).toHaveBeenCalledWith('grp-heath', 'h2');
    alert.mockRestore();
  });

  it('leaves out the banners a section carries', () => {
    const screen = render(<RouteDetailScreen />);

    expect(screen.queryByRole('button', { name: 'sections.restoreSection' })).toBeNull();
  });
});
