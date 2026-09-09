/**
 * Scenario: typing in the feed search box narrows the rendered list. The
 * highlight bundle is a batch engine read keyed on the ids it is given, so a
 * key derived from the filtered list changes with every character and the
 * engine is asked again per keystroke.
 *
 * Expected behaviour: the bundle is read once for the whole loaded feed and
 * each card looks its own id up in the returned map.
 */

import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';
import { useRouteSettings } from '@/features/routes/stores/RouteSettingsStore';

import FeedScreen from '@/app/(tabs)/index';
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));
// The feed suspends its snapshot pool when it is not the focused tab, and
// this test renders the screen on its own rather than inside a navigator.
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useIsFocused: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useTopSafeArea: () => ({ screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [],
  })
);
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
  isEngineReady: () => true,
  getNativeModule: () => null,
  getRouteDbPath: () => null,
}));

const activities = [
  { id: 'a1', name: 'Morning ride', type: 'Ride', locality: 'Perth', country: 'AU' },
  { id: 'a2', name: 'Zebra run', type: 'Run', locality: 'Perth', country: 'AU' },
  { id: 'a3', name: 'Evening swim', type: 'Swim', locality: 'Perth', country: 'AU' },
];

jest.mock('@/features/activity/hooks', () => {
  const actual = jest.requireActual('@/features/activity/hooks');
  return {
    ...actual,
    useInfiniteActivities: () => ({
      data: { pages: [activities] },
      isLoading: false,
      isError: false,
      error: null,
      isRefetching: false,
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: jest.fn(),
    }),
  };
});

jest.mock('@/features/home/hooks', () => ({
  useSummaryCardData: () => ({ showSparkline: false, refetch: jest.fn() }),
}));
jest.mock('@/features/home/hooks/useStartupData', () => ({
  useStartupData: () => ({ data: undefined }),
}));
jest.mock('@/features/insights', () => ({ useInsights: () => ({ insights: [] }) }));
jest.mock('@/features/home/components', () => ({
  SummaryCard: () => null,
  NotificationOptInCard: () => null,
  SupportCard: () => null,
}));
jest.mock('@/features/recording', () => ({
  RecordFAB: () => null,
  PendingUploadsCard: () => null,
}));
jest.mock('@/features/maps/components/TerrainSnapshotWebView', () => ({
  TerrainSnapshotWebView: () => null,
}));
jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  initTerrainPreviewCache: jest.fn(),
  consumePendingSnapshots: jest.fn().mockResolvedValue([]),
  signalSnapshotNeeded: jest.fn(),
  setPrioritySnapshotIds: jest.fn(),
}));
jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  initCameraOverrides: jest.fn(),
}));
jest.mock('@/features/activity/components', () => {
  const { Text } = require('react-native');
  const ReactLocal = require('react');
  return {
    ActivityCard: ({ activity }: { activity: { id: string; name: string } }) =>
      ReactLocal.createElement(Text, { testID: `card-${activity.id}` }, activity.name),
  };
});

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const getActivityHighlightsBundle = jest.fn((_activityIds: string[]) => ({
  indicators: [],
  routeHighlights: [],
}));

function renderFeed() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <FeedScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEngine.mockReturnValue({
    getActivityHighlightsBundle,
    subscribe: jest.fn(() => () => {}),
  } as unknown as ReturnType<typeof getEngine>);
  useRouteSettings.setState((s) => ({ settings: { ...s.settings, enabled: true } }));
});

describe('feed search does not re-read the highlight bundle', () => {
  it('asks the engine for the unfiltered feed and not again per keystroke', async () => {
    renderFeed();
    await waitFor(() => expect(getActivityHighlightsBundle).toHaveBeenCalled());

    const firstIds = getActivityHighlightsBundle.mock.calls[0][0];
    expect(firstIds).toEqual(['a1', 'a2', 'a3']);
    const callsBeforeTyping = getActivityHighlightsBundle.mock.calls.length;

    const input = screen.getByTestId('home-search-input');
    for (const query of ['z', 'ze', 'zeb', 'zebr', 'zebra']) {
      fireEvent.changeText(input, query);
    }

    await waitFor(() => expect(screen.queryByTestId('card-a1')).toBeNull());
    expect(screen.getByTestId('card-a2')).toBeTruthy();
    expect(getActivityHighlightsBundle.mock.calls.length).toBe(callsBeforeTyping);
  });

  it('does not read again when the search is cleared or a type filter is applied', async () => {
    renderFeed();
    await waitFor(() => expect(getActivityHighlightsBundle).toHaveBeenCalled());
    const baseline = getActivityHighlightsBundle.mock.calls.length;

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'zebra');
    await waitFor(() => expect(screen.queryByTestId('card-a1')).toBeNull());
    fireEvent.changeText(screen.getByTestId('home-search-input'), '');
    await waitFor(() => expect(screen.getByTestId('card-a1')).toBeTruthy());

    fireEvent.press(screen.getByTestId('home-filter-running'));
    await waitFor(() => expect(screen.queryByTestId('card-a1')).toBeNull());

    expect(getActivityHighlightsBundle.mock.calls.length).toBe(baseline);
  });

  it('reads nothing when a query matches no activity, and keeps the full-feed key', async () => {
    renderFeed();
    await waitFor(() => expect(getActivityHighlightsBundle).toHaveBeenCalled());
    const baseline = getActivityHighlightsBundle.mock.calls.length;

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'nothing matches this');
    await waitFor(() => expect(screen.queryByTestId('card-a2')).toBeNull());
    expect(getActivityHighlightsBundle.mock.calls.length).toBe(baseline);

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'ride');
    await waitFor(() => expect(screen.getByTestId('card-a1')).toBeTruthy());

    expect(getActivityHighlightsBundle.mock.calls.length).toBe(baseline);
    expect(getActivityHighlightsBundle.mock.calls.every((c) => c[0].length === 3)).toBe(true);
  });
});
