/**
 * Scenario: the section performance read leaves its delta curves owed, as it
 * does on a cold cache, since computing them decodes every lap's track and
 * time stream.
 *
 * Expected behaviour: the screen draws every figure the read carries at once,
 * loads the curves off the JS thread for the same range and sport, and offers
 * the delta plot once they land. A sport chip tap loads that sport's curves.
 * A failed load keeps every figure the read drew, and a read that holds its
 * curves loads nothing.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FfiSectionPerformanceData } from 'veloqrs';
import SectionDetailScreen from '@/app/section/[id]';

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
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useIsFocused: () => true,
  Stack: Object.assign(() => null, { Screen: () => null }),
  useLocalSearchParams: () => ({ id: 'sec-quarry' }),
  useFocusEffect: () => {},
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
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
jest.mock('@/shared/async/useAfterNavigationTransition', () => ({
  useAfterNavigationTransition: () => {},
}));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (component: unknown) => component,
}));
jest.mock('@/features/settings', () => ({
  useDebugStore: (select: (state: { enabled: boolean }) => unknown) => select({ enabled: false }),
  useGpxExport: () => ({ exportGpx: jest.fn(), exporting: false }),
}));

const SECTION_ID = 'sec-quarry';
const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);
const LENGTH_M = 1_200;

const point = (id: string, daysAgo: number, time: number, best: boolean) => ({
  lapId: id,
  activityId: id,
  activityName: `Ride ${id}`,
  activityDate: NOW - daysAgo * DAY,
  speed: LENGTH_M / time,
  sectionTime: time,
  sectionDistance: LENGTH_M,
  direction: 'same',
  isBest: best,
  outsideDistanceBand: false,
});

const lapDelta = (id: string, daysAgo: number, splits: number[]) => ({
  activityId: id,
  startIndex: 0,
  activityDate: NOW - daysAgo * DAY,
  deltaSecs: [0, ...splits.map((_, i) => splits.slice(0, i + 1).reduce((a, b) => a + b, 0))],
  splitDeltaSecs: splits,
  endDeltaSecs: splits.reduce((a, b) => a + b, 0),
});

const CURVES = {
  gridStepM: 10,
  splitStepM: 100,
  sectionLengthM: LENGTH_M,
  forward: {
    referenceActivityId: 'k1',
    referenceSource: 0,
    laps: [lapDelta('k1', 3, [0, 0]), lapDelta('k2', 2, [3, -1])],
    missing: [],
    splitSummary: {
      medianSecs: [3, -1],
      lowerQuartileSecs: [NaN, NaN],
      upperQuartileSecs: [NaN, NaN],
      laps: [5, 5],
    },
  },
};

function performanceRead(
  curves: typeof CURVES | undefined,
  curvesPending: boolean,
  sportType = 'Ride'
): FfiSectionPerformanceData {
  return {
    sportType,
    sportCounts: [
      { sportType: 'Ride', count: 2 },
      { sportType: 'Run', count: 2 },
    ],
    performances: { records: [], bestForwardIsPr: false, bestReverseIsPr: false },
    chartData: {
      points: [point('k1', 3, 240, true), point('k2', 2, 242, false)],
      minSpeed: 4.9,
      maxSpeed: 5,
      hasReverseRuns: false,
      totalActivities: 2,
    },
    excludedPoints: [],
    lapRecords: [],
    bestForwardIsRecord: false,
    bestReverseIsRecord: false,
    trendCurves: {},
    histograms: {},
    correlations: [],
    correlationFloor: 0,
    curves,
    curvesPending,
  } as unknown as FfiSectionPerformanceData;
}

let mockCurves: typeof CURVES | undefined;
let mockCurvesPending = false;

const mockEngine = {
  subscribe: () => () => {},
  getSectionDetailData: jest.fn(() => ({
    activityCount: 2,
    section: {
      id: SECTION_ID,
      sectionType: 'auto',
      name: 'Quarry climb',
      sportTypes: ['Ride', 'Run'],
      encodedPolyline: new ArrayBuffer(0),
      distanceMeters: LENGTH_M,
      activityIds: ['k1', 'k2'],
      activityPortions: [],
      visitCount: 2,
      isUserDefined: false,
      createdAt: '2026-01-01T00:00:00Z',
      disabled: false,
      isLift: false,
    },
    mergeCandidates: [],
    excludedActivityIds: [],
    hasOriginalBounds: false,
    activityRows: [],
    mapSignatures: [],
    missingTimeStreamIds: [],
    history: [],
    geometryVersions: [],
    canNameFromPlaces: false,
  })),
  getSectionDetailPerformance: jest.fn((_id: string, _days: number, sport?: string) =>
    performanceRead(mockCurves, mockCurvesPending, sport)
  ),
  loadSectionDetailPerformance: jest.fn(async (_id: string, _days: number, sport?: string) =>
    performanceRead(CURVES, false, sport)
  ),
  getExcludedActivityIds: jest.fn(() => []),
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  isEngineReady: () => true,
}));

async function openSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={client}>
      <SectionDetailScreen />
    </QueryClientProvider>
  );
  await act(async () => {});
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurves = undefined;
  mockCurvesPending = true;
});

describe('section page curves owed', () => {
  it('loads the curves off the thread for the range and sport the read answered', async () => {
    const screen = await openSection();

    expect(mockEngine.getSectionDetailPerformance).toHaveBeenCalled();
    const [, days, sport] = mockEngine.getSectionDetailPerformance.mock.calls[0];
    expect(mockEngine.loadSectionDetailPerformance).toHaveBeenCalledTimes(1);
    expect(mockEngine.loadSectionDetailPerformance).toHaveBeenCalledWith(
      SECTION_ID,
      days,
      sport,
      undefined
    );
    expect(screen.getByTestId('chart-plot-delta')).toBeTruthy();
  });

  it('loads the curves of the sport a chip picks', async () => {
    const screen = await openSection();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('sport-pill-Run'));
    });

    expect(mockEngine.getSectionDetailPerformance).toHaveBeenLastCalledWith(
      SECTION_ID,
      expect.any(Number),
      'Run',
      undefined
    );
    expect(mockEngine.loadSectionDetailPerformance).toHaveBeenLastCalledWith(
      SECTION_ID,
      expect.any(Number),
      'Run',
      undefined
    );
  });

  it('keeps every figure the read drew when the load fails', async () => {
    mockEngine.loadSectionDetailPerformance.mockRejectedValueOnce(new Error('engine down'));
    const screen = await openSection();

    expect(screen.queryByTestId('chart-plot-delta')).toBeNull();
    expect(screen.getByTestId('performance-chart-panel')).toBeTruthy();
  });

  it('loads nothing when the read holds its curves', async () => {
    mockCurves = CURVES;
    mockCurvesPending = false;
    const screen = await openSection();

    expect(mockEngine.loadSectionDetailPerformance).not.toHaveBeenCalled();
    expect(screen.getByTestId('chart-plot-delta')).toBeTruthy();
  });
});
