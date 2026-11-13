/**
 * Scenario: the zone, coverage and curve reads feed only the Trends and
 * Performance pages, which stay mounted once visited, yet a range change made
 * on the Fitness page re-ran every one of them in the tap's render.
 *
 * Expected behaviour: a range pressed on a page that does not show those
 * reads makes none of them; the page that does shows the range chosen when it
 * is next in front.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage } from 'veloqrs';

import FitnessScreen from '@/app/(tabs)/fitness';
import { getEngine } from '@/shared/native/engine';
import { fitnessScreenRead } from '../__shared__/fitnessScreenRead';
import { initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/native/useSyncStatus', () => ({ useSyncState: () => null }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/debug/tabSwitchTiming', () => ({ useTabFirstFrame: jest.fn() }));
jest.mock('@/shared/debug/renderTimer', () => ({
  logScreenRender: () => jest.fn(),
  logMemory: jest.fn(),
  recordAppMetric: jest.fn(),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: require('../__shared__/nativeHeaderStandIn').Stack,
  router: { push: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  ScrollView: require('react-native').ScrollView,
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useTopSafeArea: () => ({ screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (Component: unknown) => Component,
}));
jest.mock('@/shared/app/useRevealChart', () => ({
  useRevealChart: () => ({
    scrollRef: { current: null },
    onAnchorLayout: jest.fn(),
    onHeaderLayout: jest.fn(),
    onScrollBeginDrag: jest.fn(),
  }),
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'MaterialCommunityIcons');
jest.mock('@/features/wellness', () => ({
  ...jest.requireActual('@/features/wellness'),
  useWellness: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
  useWellnessCoverage: () => require('veloqrs').RangeCoverage.Loaded,
}));
jest.mock('@/features/stats', () => ({
  ...jest.requireActual('@/features/stats'),
  PowerCurveChart: () => null,
  PaceCurveChart: () => null,
  SwimPaceCurveChart: () => null,
  useSeasonBests: () => ({
    efforts: [],
    climbing: [],
    climbingStatus: null,
    isLoading: false,
    headerSummary: null,
  }),
}));
jest.mock('@/features/fitness/hooks/useDailyActivityLoads', () => ({
  useDailyActivityLoads: () => [],
}));
jest.mock('@/shared/native/useRangeCoverage', () => ({
  ...jest.requireActual('@/shared/native/useRangeCoverage'),
  useRangeCoverage: () => require('veloqrs').RangeCoverage.Loaded,
}));
jest.mock('@/features/fitness/components/sections', () => {
  const { View } = require('react-native');
  return {
    FitnessChartCard: () => <View testID="fitness-chart-canvas" />,
    PerformanceCurveSection: jest.requireActual(
      '@/features/fitness/components/sections/PerformanceCurveSection'
    ).PerformanceCurveSection,
    FitnessTrendSections: () => <View testID="fitness-trends" />,
    FitnessDefinitionsCard: View,
    WellnessTrendsCard: () => <View testID="wellness-card" />,
  };
});
jest.mock('@/features/fitness/components/BestEffortsHeaderButton', () => ({
  BestEffortsHeaderButton: () => null,
}));

const listeners = new Map<string, Set<() => void>>();

const totals = (count: number, hours: number) => ({
  count,
  totalDuration: hours * 3600,
  totalDistance: count * 10_000,
  totalTss: count * 50,
});

const engine = {
  subscribe: jest.fn((event: string, cb: () => void) => {
    const set = listeners.get(event) ?? new Set<() => void>();
    set.add(cb);
    listeners.set(event, set);
    return () => set.delete(cb);
  }),
  rangeCoverage: jest.fn(() => RangeCoverage.Loaded),
  getZoneDistribution: jest.fn(() => ({ seconds: [60, 30], shares: [67, 33], names: [] })),
  getPowerCurve: jest.fn(() => null),
  getPaceCurve: jest.fn(() => null),
  syncPowerCurve: jest.fn(),
  syncPaceCurve: jest.fn(),
  getFitnessScreenData: fitnessScreenRead({
    heatmap: (_first, last) => [{ date: last, intensity: 3, maxDuration: 6000, activityCount: 2 }],
    period: () => totals(2, 4),
  }),
  getTrainingScreenData: jest.fn(),
  getFeedCards: jest.fn(() => []),
};

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

async function mountVisitedPages() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <FitnessScreen />
    </QueryClientProvider>
  );
  for (const place of ['performance', 'trends', 'fitness']) {
    await fireEvent.press(await screen.findByTestId(`tab-${place}`));
  }
  return view;
}

describe('a range change on the Fitness page', () => {
  vaultIt('makes no zone, coverage or curve read', async () => {
    await mountVisitedPages();
    const reads = [engine.getZoneDistribution, engine.rangeCoverage, engine.getPowerCurve];
    reads.forEach((read) => read.mockClear());

    const pill = within(screen.getByTestId('tab-page-fitness')).getByTestId('fitness-range-6m');
    await fireEvent.press(pill);

    expect(engine.getZoneDistribution).not.toHaveBeenCalled();
    expect(engine.rangeCoverage).not.toHaveBeenCalled();
    expect(engine.getPowerCurve).not.toHaveBeenCalled();
  });

  it('reads the chosen range when the Trends page is next in front', async () => {
    await mountVisitedPages();
    const pill = within(screen.getByTestId('tab-page-fitness')).getByTestId('fitness-range-6m');
    await fireEvent.press(pill);
    engine.getZoneDistribution.mockClear();

    await fireEvent.press(await screen.findByTestId('tab-trends'));

    expect(engine.getZoneDistribution).toHaveBeenCalled();
    const [, , start, end] = engine.getZoneDistribution.mock.calls[0] as unknown as number[];
    expect((end - start) / 86400).toBeGreaterThan(150);
  });
});
