/**
 * Scenario: a Ride route run both ways, so the chart offers a Forward and a
 * Reverse chip and the Summary marks each best with its direction's arrow.
 *
 * Expected behaviour: Forward is one colour across the page, the brand primary
 * for the scheme on screen, never the sport's colour.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { act, render, within } from '@testing-library/react-native';
import RouteDetailScreen from '@/app/route/[id]';
import { useThemePreferenceStore } from '@/shared/app';
import { getActivityColor } from '@/shared/activity/activityUtils';
import { colors, darkColors } from '@/theme';

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
  useLocalSearchParams: () => ({ id: 'grp-ridge' }),
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
jest.mock('@/features/routes/components/RouteDetailMap', () => ({
  RouteDetailMap: () => null,
}));

const DAY = 86_400;
const FIRST = 1_780_000_000;
const LENGTH_M = 3_000;

const point = (id: string, day: number, time: number, direction: 'same' | 'reverse') => ({
  lapId: id,
  activityId: id,
  activityName: `Ride ${id}`,
  activityDate: FIRST + day * DAY,
  speed: LENGTH_M / time,
  sectionTime: time,
  sectionDistance: LENGTH_M,
  direction,
  isBest: false,
  outsideDistanceBand: false,
  matchPercentage: 95,
});

const record = (id: string, day: number, time: number, direction: 'same' | 'reverse') => ({
  activityId: id,
  activityName: `Ride ${id}`,
  activityDate: FIRST + day * DAY,
  laps: [],
  lapCount: 1,
  bestTime: time,
  bestPace: LENGTH_M / time,
  avgTime: time,
  avgPace: LENGTH_M / time,
  direction,
  sectionDistance: LENGTH_M,
});

const stats = (time: number) => ({
  avgTime: time,
  avgSpeed: LENGTH_M / time,
  lastActivity: FIRST,
  count: 2,
});

const mockEngine = {
  subscribe: () => () => {},
  getRouteDetailData: jest.fn(() => ({
    group: {
      groupId: 'grp-ridge',
      representativeId: 'r1',
      activityIds: ['r1', 'r2', 'r3', 'r4'],
      activityCount: 4,
      sportType: 'Ride',
      sportTypes: ['Ride'],
      customName: 'Ridge Loop',
    },
    activityCount: 4,
    excludedActivityIds: [],
    mapSignatures: [],
    missingTimeStreamIds: [],
  })),
  getRouteDetailPerformance: jest.fn(() => ({
    sportType: 'Ride',
    sportCounts: [{ sportType: 'Ride', count: 4 }],
    performances: {
      records: [],
      bestForwardRecord: record('r1', 0, 600, 'same'),
      bestReverseRecord: record('r3', 2, 640, 'reverse'),
      bestForwardIsPr: false,
      bestReverseIsPr: false,
      forwardStats: stats(610),
      reverseStats: stats(650),
    },
    chartData: {
      points: [
        point('r1', 0, 600, 'same'),
        point('r2', 1, 620, 'same'),
        point('r3', 2, 640, 'reverse'),
        point('r4', 3, 660, 'reverse'),
      ],
      minSpeed: LENGTH_M / 660,
      maxSpeed: LENGTH_M / 600,
      hasReverseRuns: true,
      totalActivities: 4,
      firstActivityDate: FIRST,
      lastActivityDate: FIRST + 3 * DAY,
    },
    excludedPoints: [],
    lapRecords: [],
    bestForwardIsRecord: false,
    bestReverseIsRecord: false,
    trendCurves: {},
    histograms: {},
    correlations: [],
    correlationFloor: 0,
    curvesPending: false,
  })),
  loadRouteDetailPerformance: jest.fn(),
  excludeActivityFromRoute: jest.fn(),
  includeActivityInRoute: jest.fn(),
  setRouteRepresentative: jest.fn(),
  resetRouteRepresentative: jest.fn(),
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  isEngineReady: () => true,
}));

type Screen = Awaited<ReturnType<typeof render>>;

function chipFill(screen: Screen): unknown {
  return StyleSheet.flatten(screen.getByTestId('section-chart-direction-forward').props.style)
    .backgroundColor;
}

function summaryArrowColour(screen: Screen): unknown {
  const cell = screen
    .getAllByTestId(/^section-summary-cell-/)
    .find((candidate) => within(candidate).queryByTestId('section-best-forward'));
  if (!cell) throw new Error('the forward best sits in no summary cell');
  const [arrow] = within(cell).UNSAFE_getAllByType(MaterialCommunityIcons);
  return arrow.props.color;
}

afterEach(() => {
  act(() => useThemePreferenceStore.setState({ preference: 'system' }));
});

describe('route page forward colour', () => {
  it.each([
    ['light', colors.actionPrimary],
    ['dark', darkColors.actionPrimary],
  ] as const)(
    'paints Forward in the %s primary on the chart and the Summary',
    async (scheme, primary) => {
      act(() => useThemePreferenceStore.setState({ preference: scheme }));
      const screen = await render(<RouteDetailScreen />);

      expect(chipFill(screen)).toBe(primary);
      expect(summaryArrowColour(screen)).toBe(primary);
      expect(primary).not.toBe(getActivityColor('Ride'));
    }
  );
});
