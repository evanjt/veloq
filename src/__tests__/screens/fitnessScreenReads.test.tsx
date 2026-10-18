/**
 * Scenario: the fitness tab holds the calendar, the weekly card and the year
 * comparison beside its own trend, speeds and strip, and those cards read a
 * training screen read of their own beside the fitness one, so the tab made
 * two screen reads on mount and two on each `activities` event.
 *
 * Expected behaviour: the whole tab, every page visited and its cards mounted
 * as each page mounts them, paints from the one fitness screen read, once on
 * mount and once more when activities change.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage } from 'veloqrs';

import FitnessScreen from '@/app/(tabs)/fitness';
import { getEngine } from '@/shared/native/engine';
import { fitnessScreenRead } from '../__shared__/fitnessScreenRead';
import { i18n, initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/debug/tabSwitchTiming', () => ({ useTabFirstFrame: jest.fn() }));
jest.mock('@/shared/debug/renderTimer', () => ({
  logScreenRender: () => jest.fn(),
  logMemory: jest.fn(),
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
  usePaceCurve: () => ({ data: undefined }),
  useSeasonBests: () => ({
    efforts: [],
    climbing: [],
    climbingStatus: null,
    isLoading: false,
    headerSummary: null,
  }),
}));
jest.mock('@/features/fitness/hooks/useZoneDistribution', () => ({
  useZoneDistribution: () => undefined,
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
    PerformanceCurveSection: () => <View testID="performance-curves" />,
    FitnessTrendSections: () => <View testID="fitness-trends" />,
    FitnessDefinitionsCard: View,
    WellnessTrendsCard: () => <View testID="wellness-card" />,
  };
});
jest.mock('@/features/fitness/components/BestEffortsHeaderButton', () => ({
  BestEffortsHeaderButton: () => null,
}));

const listeners = new Map<string, Set<() => void>>();

async function emit(event: string) {
  await act(() => {
    listeners.get(event)?.forEach((cb) => cb());
  });
}

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
  getFitnessScreenData: fitnessScreenRead({
    heatmap: (_first, last) => [{ date: last, intensity: 3, maxDuration: 6000, activityCount: 2 }],
    period: () => totals(2, 4),
  }),
  getTrainingScreenData: jest.fn(),
  getActivityBodies: jest.fn(() => []),
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

async function mountScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <FitnessScreen />
    </QueryClientProvider>
  );
  // Every page visited and every staged card mounted, the calendar, the week
  // and the year among them.
  for (const place of ['performance', 'trends', 'calendar']) {
    const tab = await screen.findByTestId(`tab-${place}`);
    await fireEvent.press(tab);
  }
  const calendar = within(screen.getByTestId('tab-page-calendar'));
  await waitFor(() => expect(calendar.getByTestId('weekly-summary')).toBeTruthy());
  await waitFor(() => expect(calendar.getByText(i18n.t('stats.activityCalendar'))).toBeTruthy());
  await waitFor(() => expect(calendar.getByText(i18n.t('stats.seasonComparison'))).toBeTruthy());
  // The pages out of view are hidden from the accessibility tree, not unmounted.
  const hidden = { includeHiddenElements: true } as const;
  expect(screen.getByTestId('performance-curves', hidden)).toBeTruthy();
  expect(screen.getByTestId('fitness-trends', hidden)).toBeTruthy();
  return view;
}

describe('the fitness tab', () => {
  it('paints every card from one fitness screen read and no training read', async () => {
    await mountScreen();

    expect(engine.getFitnessScreenData).toHaveBeenCalledTimes(1);
    expect(engine.getTrainingScreenData).not.toHaveBeenCalled();
  });

  it('reads once more when activities change, not once per card', async () => {
    await mountScreen();

    await emit('activities');

    expect(engine.getFitnessScreenData).toHaveBeenCalledTimes(2);
    expect(engine.getTrainingScreenData).not.toHaveBeenCalled();
  });
});
