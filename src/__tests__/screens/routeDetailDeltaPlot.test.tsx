/**
 * Scenario: the route performance read carries delta curves for the route's
 * attempts, measured along its representative line.
 *
 * Expected behaviour: the route chart offers the delta plot, and choosing it
 * hands the route map the emphasised attempt's splits to colour the line by,
 * then takes them back when another plot is chosen. A read with no curves
 * offers no delta plot and colours nothing. A read that leaves its curves
 * owed is loaded again off the JS thread, once the attempts missing a time
 * stream have fetched it, and the loaded curves are offered.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { engine as mockStreams, StartOutcome } from 'veloqrs';
import RouteDetailScreen from '@/app/route/[id]';
import type { SectionDeltaLine } from '@/features/routes';

jest.mock('veloqrs', () => {
  const stub = require('../__shared__/veloqrsStub');
  return stub.withOverrides({
    FfiCorrelation_Tags: {
      TooFew: 'TooFew',
      Undefined: 'Undefined',
      Inconclusive: 'Inconclusive',
      Mover: 'Mover',
    },
    // The stream fetch the route page starts for attempts missing one.
    engine: {
      ...stub.engine,
      syncTimeStreams: jest.fn(() => ({ outcome: stub.StartOutcome.Started })),
    },
  });
});
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: 'grp-quarry' }),
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

const mockMapDeltaLines: (SectionDeltaLine | null | undefined)[] = [];
jest.mock('@/features/routes/components/RouteDetailMap', () => ({
  RouteDetailMap: ({ deltaLine }: { deltaLine?: SectionDeltaLine | null }) => {
    mockMapDeltaLines.push(deltaLine);
    return null;
  },
}));

const DAY = 86_400;
const FIRST = 1_780_000_000;
const ROUTE_LENGTH_M = 2_400;

const point = (id: string, day: number, time: number) => ({
  lapId: id,
  activityId: id,
  activityName: `Ride ${id}`,
  activityDate: FIRST + day * DAY,
  speed: ROUTE_LENGTH_M / time,
  sectionTime: time,
  sectionDistance: ROUTE_LENGTH_M,
  direction: 'same',
  isBest: id === 'q1',
  outsideDistanceBand: false,
  matchPercentage: 96,
});

const lapDelta = (id: string, day: number, splits: number[]) => ({
  activityId: id,
  startIndex: 0,
  activityDate: FIRST + day * DAY,
  deltaSecs: Float32Array.from([
    0,
    ...splits.map((_, i) => splits.slice(0, i + 1).reduce((a, b) => a + b, 0)),
  ]),
  splitDeltaSecs: Float32Array.from(splits),
  endDeltaSecs: splits.reduce((a, b) => a + b, 0),
});

const CURVES = {
  gridStepM: 10,
  splitStepM: 100,
  sectionLengthM: ROUTE_LENGTH_M,
  forward: {
    referenceActivityId: 'q1',
    referenceSource: 0,
    laps: [lapDelta('q1', 0, [0, 0, 0]), lapDelta('q2', 1, [2, -1, 4])],
    missing: [],
    peakDeltaSecs: 5,
  },
};

let mockCurves: typeof CURVES | undefined;
let mockCurvesPending = false;
let mockMissingStreams: string[] = [];

function mockPerformanceRead(curves: typeof CURVES | undefined, curvesPending: boolean) {
  return {
    sportType: 'Ride',
    sportCounts: [{ sportType: 'Ride', count: 2 }],
    performances: { records: [], bestForwardIsPr: false, bestReverseIsPr: false },
    chartData: {
      points: [point('q1', 0, 480), point('q2', 1, 485)],
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
  };
}

const mockEngine = {
  subscribe: () => () => {},
  getRouteDetailData: jest.fn(() => ({
    group: {
      groupId: 'grp-quarry',
      representativeId: 'q1',
      activityIds: ['q1', 'q2'],
      activityCount: 2,
      sportType: 'Ride',
      sportTypes: ['Ride'],
      customName: 'Quarry Lane',
    },
    groups: [],
    activityCount: 2,
    performances: { performances: [], activityMetrics: [] },
    routeNames: {},
    excludedActivityIds: [],
    mapSignatures: [],
    missingTimeStreamIds: mockMissingStreams,
  })),
  getRouteDetailPerformance: jest.fn(() => mockPerformanceRead(mockCurves, mockCurvesPending)),
  loadRouteDetailPerformance: jest.fn(async () => mockPerformanceRead(CURVES, false)),
  excludeActivityFromRoute: jest.fn(),
  includeActivityInRoute: jest.fn(),
  setRouteRepresentative: jest.fn(),
  resetRouteRepresentative: jest.fn(),
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  isEngineReady: () => true,
}));

const lastMapDeltaLine = () => mockMapDeltaLines[mockMapDeltaLines.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  mockMapDeltaLines.length = 0;
  mockCurves = CURVES;
  mockCurvesPending = false;
  mockMissingStreams = [];
});

describe('route page delta plot', () => {
  it('offers the delta plot and colours the route line by the newest attempt', () => {
    const screen = render(<RouteDetailScreen />);

    expect(lastMapDeltaLine()).toBeFalsy();
    fireEvent.press(screen.getByTestId('chart-plot-delta'));

    expect(screen.getByTestId('section-delta-chart')).toBeTruthy();
    expect(lastMapDeltaLine()).toEqual({
      splits: Float32Array.from([2, -1, 4]),
      splitStepM: 100,
      sectionLengthM: ROUTE_LENGTH_M,
      direction: 'forward',
    });
  });

  it('takes the colouring back when the scatter is chosen again', () => {
    const screen = render(<RouteDetailScreen />);

    fireEvent.press(screen.getByTestId('chart-plot-delta'));
    fireEvent.press(screen.getByTestId('chart-plot-scatter'));

    expect(lastMapDeltaLine()).toBeNull();
  });

  it('offers no delta plot when the read carries no curves', () => {
    mockCurves = undefined;
    const screen = render(<RouteDetailScreen />);

    expect(screen.queryByTestId('chart-plot-delta')).toBeNull();
    expect(lastMapDeltaLine()).toBeFalsy();
  });
});

describe('route page curves owed', () => {
  beforeEach(() => {
    mockCurves = undefined;
    mockCurvesPending = true;
  });

  it('reads once and loads the curves when no attempt is missing its stream', async () => {
    const screen = render(<RouteDetailScreen />);
    expect(screen.queryByTestId('chart-plot-delta')).toBeNull();

    await act(async () => {});

    expect(mockStreams.syncTimeStreams).not.toHaveBeenCalled();
    expect(mockEngine.getRouteDetailPerformance).toHaveBeenCalledTimes(1);
    expect(mockEngine.loadRouteDetailPerformance).toHaveBeenCalledTimes(1);
    expect(mockEngine.loadRouteDetailPerformance).toHaveBeenCalledWith('grp-quarry', 0, undefined);
    fireEvent.press(screen.getByTestId('chart-plot-delta'));
    expect(lastMapDeltaLine()?.splits).toEqual(Float32Array.from([2, -1, 4]));
  });

  it('fetches the missing streams and loads the curves only once they land', async () => {
    mockMissingStreams = ['q2'];
    let announce: ((payload: unknown) => void) | undefined;
    jest.mocked(mockStreams.subscribe).mockImplementation(((
      channel: string,
      listener: (payload: unknown) => void
    ) => {
      if (channel === 'timeStreamsStored') announce = listener;
      return () => {};
    }) as never);
    const screen = render(<RouteDetailScreen />);

    expect(mockStreams.syncTimeStreams).toHaveBeenCalledWith(['q2']);
    expect(mockEngine.loadRouteDetailPerformance).not.toHaveBeenCalled();

    await act(async () => {
      announce?.({ activityIds: ['q2'] });
    });

    expect(mockEngine.loadRouteDetailPerformance).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chart-plot-delta')).toBeTruthy();
  });

  it('loads no curves when the wait ends with a stream still missing', async () => {
    mockMissingStreams = ['q2'];
    jest.mocked(mockStreams.syncTimeStreams).mockReturnValueOnce({ outcome: StartOutcome.Held });
    const screen = render(<RouteDetailScreen />);

    await act(async () => {});

    expect(mockEngine.loadRouteDetailPerformance).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chart-plot-delta')).toBeNull();
    expect(screen.getByTestId('performance-chart-panel')).toBeTruthy();
  });

  it('keeps every figure the read drew when the load fails', async () => {
    mockEngine.loadRouteDetailPerformance.mockRejectedValueOnce(new Error('engine down'));
    const screen = render(<RouteDetailScreen />);

    await act(async () => {});

    expect(screen.queryByTestId('chart-plot-delta')).toBeNull();
    expect(screen.queryByTestId('route-performance-failure')).toBeNull();
    expect(screen.getByTestId('performance-chart-panel')).toBeTruthy();
  });

  it('loads nothing when the read holds its curves', async () => {
    mockCurves = CURVES;
    mockCurvesPending = false;
    render(<RouteDetailScreen />);

    await act(async () => {});

    expect(mockEngine.loadRouteDetailPerformance).not.toHaveBeenCalled();
  });
});
