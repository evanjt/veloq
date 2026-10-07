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
import { act, render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FlatList, Platform } from 'react-native';

import { getEngine } from '@/shared/native/engine';
import { useRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { useAuthStore } from '@/shared/app/AuthStore';

import FeedScreen from '@/app/(tabs)/index';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';

jest.mock('@/shared/native/syncRefresh', () => ({
  requestSyncRefresh: jest.fn(),
  cancelSyncRefresh: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));
// The feed suspends its snapshot pool when it is not the focused tab, and
// this test renders the screen on its own rather than inside a navigator.
let mockFeedFocused = true;
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useIsFocused: () => mockFeedFocused,
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

const initialActivities = [
  { id: 'a1', name: 'Morning ride', type: 'Ride' },
  { id: 'a2', name: 'Zebra run', type: 'Run' },
  { id: 'a3', name: 'Evening swim', type: 'Swim' },
];
let activities = initialActivities;
let mockFeedData = { pages: [activities] };
let mockHasPreviousPage = false;
let mockIsRefetching = false;
let mockSummaryRefetch = jest.fn();
const mockRecordFeedSeen = jest.fn();
const mockFetchPreviousPage = jest.fn();
const mockSyncListeners = new Map<string, Set<() => void>>();
let mockSyncCompleted = 0;

jest.mock('@/features/activity/hooks', () => {
  const actual = jest.requireActual('@/features/activity/hooks');
  return {
    ...actual,
    useInfiniteActivities: () => ({
      data: mockFeedData,
      isLoading: false,
      isError: false,
      error: null,
      isRefetching: mockIsRefetching,
      fetchNextPage: jest.fn(),
      fetchPreviousPage: mockFetchPreviousPage,
      hasPreviousPage: mockHasPreviousPage,
      isFetchingPreviousPage: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: jest.fn(),
    }),
  };
});

jest.mock('@/features/insights', () => ({ useInsights: () => ({ insights: [] }) }));
jest.mock('@/features/home', () => ({
  ...jest.requireActual('@/features/home/store'),
  feedEmptyState: jest.requireActual('@/features/home/lib/feedEmptyState').feedEmptyState,
  summaryCardTarget: jest.requireActual('@/features/home/lib/summaryCardTargets').summaryCardTarget,
  useSummaryCardData: () => ({ showSparkline: false, refetch: mockSummaryRefetch }),
  useStartupData: () => ({ data: mockStartupData, refresh: jest.fn() }),
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
}));
jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  initCameraOverrides: jest.fn(),
}));
jest.mock('@/features/activity/components', () => {
  const { Text } = require('react-native');
  const ReactLocal = require('react');
  return {
    ActivityCard: ({
      activity,
      startupTrack,
    }: {
      activity: { id: string; name: string };
      startupTrack?: { coordinates: { latitude: number }[] };
    }) => {
      mockCardTracks.set(activity.id, startupTrack);
      return ReactLocal.createElement(
        Text,
        { testID: `card-${activity.id}` },
        startupTrack?.coordinates[0]?.latitude ?? activity.name
      );
    },
  };
});

const mockCardTracks = new Map<string, unknown>();
let mockStartupData:
  | {
      previewTracks: Map<
        string,
        {
          activityId: string;
          coordinates: { latitude: number; longitude: number }[];
          altitude: undefined;
        }
      >;
      newActivityIds?: ReadonlySet<string>;
    }
  | undefined;

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

/** The engine's search over the stored library, which here is the loaded feed. */
const CHIP_TYPES: Record<number, string> = { 0: 'Ride', 1: 'Run', 2: 'Swim' };
function searchActivityBodies(query: { needle: string; sportGroups: number[] }) {
  const needle = query.needle.toLowerCase();
  const chip = (type: string) =>
    query.sportGroups.length === 0 ||
    (query.sportGroups.includes(3)
      ? !Object.values(CHIP_TYPES).includes(type)
      : query.sportGroups.some((group) => CHIP_TYPES[group] === type));
  const matched = activities.filter(
    (a) =>
      chip(a.type) &&
      (a.name.toLowerCase().includes(needle) || a.type.toLowerCase().includes(needle))
  );
  return {
    bodies: matched.map((a) => JSON.stringify(a)),
    matchedCount: matched.length,
    hasMore: false,
  };
}
const getActivityHighlightsBundle = jest.fn((_activityIds: string[]) => ({
  indicators: [],
  routeHighlights: [],
}));

function renderFeed() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={client}>
      <FeedScreen />
    </QueryClientProvider>
  );
  return {
    ...view,
    rerenderFeed: () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <FeedScreen />
        </QueryClientProvider>
      ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCardTracks.clear();
  mockStartupData = undefined;
  activities = initialActivities;
  mockFeedData = { pages: [activities] };
  mockHasPreviousPage = false;
  mockIsRefetching = false;
  mockSummaryRefetch = jest.fn();
  mockRecordFeedSeen.mockClear();
  mockFeedFocused = true;
  mockSyncCompleted = 0;
  mockSyncListeners.clear();
  mockGetEngine.mockReturnValue({
    getActivityHighlightsBundle,
    searchActivityBodies,
    recordFeedSeen: mockRecordFeedSeen,
    // The feed reads the sync state to decide whether an empty library is a
    // first launch standing by or a library with nothing in it.
    getSyncStatus: jest.fn(() => ({
      state: 0,
      inFlight: 0,
      completed: mockSyncCompleted,
      total: 3,
    })),
    subscribe: jest.fn((event: string, cb: () => void) => {
      const listeners = mockSyncListeners.get(event) ?? new Set<() => void>();
      listeners.add(cb);
      mockSyncListeners.set(event, listeners);
      return () => listeners.delete(cb);
    }),
  } as unknown as ReturnType<typeof getEngine>);
  useRouteSettings.setState((s) => ({ settings: { ...s.settings, enabled: true } }));
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
});

it('dismisses a new card when it leaves view and keeps the callback stable', async () => {
  mockStartupData = { previewTracks: new Map(), newActivityIds: new Set(['a1']) };
  const feed = renderFeed();
  const list = await screen.findByTestId('home-activity-list');
  const callback = list.props.onViewableItemsChanged;

  act(() => {
    callback({
      viewableItems: [{ key: 'a1', index: 0, isViewable: true }],
      changed: [{ key: 'a1', index: 0, isViewable: true }],
    });
    callback({
      viewableItems: [],
      changed: [{ key: 'a1', index: 0, isViewable: false }],
    });
  });

  expect(mockRecordFeedSeen).toHaveBeenCalledWith({
    tag: 'Dismissed',
    inner: { activityIds: ['a1'] },
  });
  feed.rerenderFeed();
  expect(screen.getByTestId('home-activity-list').props.onViewableItemsChanged).toBe(callback);
});

it('replaces a startup preview when its track moves under the same activity id', async () => {
  const track = (activityId: string, latitude: number) => ({
    activityId,
    coordinates: [{ latitude, longitude: 7.3 }],
    altitude: undefined,
  });
  const a2 = track('a2', 46.5);
  mockStartupData = {
    previewTracks: new Map([
      ['a1', track('a1', 46.2)],
      ['a2', a2],
    ]),
  };
  const { rerender } = renderFeed();
  await waitFor(() => expect(screen.getByTestId('card-a1').props.children).toBe(46.2));
  const heldA2 = mockCardTracks.get('a2');

  mockStartupData = {
    previewTracks: new Map([
      ['a1', track('a1', 47.1)],
      ['a2', a2],
    ]),
  };
  rerender(
    <QueryClientProvider client={new QueryClient()}>
      <FeedScreen />
    </QueryClientProvider>
  );

  await waitFor(() => expect(screen.getByTestId('card-a1').props.children).toBe(47.1));
  expect(mockCardTracks.get('a2')).toBe(heldA2);
});

describe('feed search does not re-read the highlight bundle', () => {
  it('scrolls past the measured search section on Android when the estimate matches', () => {
    const platform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    try {
      renderFeed();
      const list = screen.getByTestId('home-activity-list');
      const searchSection = list.props.ListHeaderComponent().props.children[0];
      act(() => searchSection.props.onLayout({ nativeEvent: { layout: { height: 78 } } }));
      expect(scrollToOffset).toHaveBeenCalledWith({ offset: 78, animated: false });
    } finally {
      scrollToOffset.mockRestore();
      Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
    }
  });

  it('hides revealed controls after returning to an unfiltered feed', () => {
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    try {
      const feed = renderFeed();
      const list = screen.getByTestId('home-activity-list');
      const searchSection = list.props.ListHeaderComponent().props.children[0];
      act(() => searchSection.props.onLayout({ nativeEvent: { layout: { height: 94 } } }));
      scrollToOffset.mockClear();

      mockFeedFocused = false;
      feed.rerenderFeed();
      mockFeedFocused = true;
      feed.rerenderFeed();

      expect(scrollToOffset).toHaveBeenCalledWith({ offset: 94, animated: false });
    } finally {
      scrollToOffset.mockRestore();
    }
  });

  it('does not render again for sync progress within the same state', async () => {
    let renders = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <React.Profiler
          id="feed"
          onRender={() => {
            renders += 1;
          }}
        >
          <FeedScreen />
        </React.Profiler>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByTestId('home-activity-list')).toBeTruthy());
    const before = renders;

    act(() => {
      mockSyncCompleted = 1;
      mockSyncListeners.get('syncProgress')?.forEach((notify) => notify());
    });
    expect(renders).toBe(before);
  });

  it('anchors only when an evicted page can be fetched back', () => {
    const view = renderFeed();
    const list = () => screen.getByTestId('home-activity-list');
    expect(list().props.maintainVisibleContentPosition).toBeUndefined();
    fireEvent(list(), 'startReached');
    expect(mockFetchPreviousPage).not.toHaveBeenCalled();

    mockHasPreviousPage = true;
    view.rerenderFeed();
    expect(list().props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 1 });
    fireEvent(list(), 'startReached');
    expect(mockFetchPreviousPage).toHaveBeenCalledTimes(1);
  });

  it('shows a changed same-id row and finds its new name', async () => {
    const view = renderFeed();
    await waitFor(() => expect(screen.getByTestId('card-a1').props.children).toBe('Morning ride'));
    const firstList = screen.getByTestId('home-activity-list').props.data;

    view.rerenderFeed();
    expect(screen.getByTestId('home-activity-list').props.data).toBe(firstList);

    activities = [{ ...initialActivities[0], name: 'Renamed ride' }, ...initialActivities.slice(1)];
    mockFeedData = { pages: [activities] };
    view.rerenderFeed();
    await waitFor(() => expect(screen.getByTestId('card-a1').props.children).toBe('Renamed ride'));
    fireEvent.changeText(screen.getByTestId('home-search-input'), 'renamed');
    expect(screen.getByTestId('card-a1')).toBeTruthy();
  });
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

describe('feed pull to refresh', () => {
  it('shows the disc only for a pull, not for background feed refetches', async () => {
    const feed = renderFeed();
    const list = await screen.findByTestId('home-activity-list');
    const refreshing = () => list.props.refreshControl.props.refreshing;
    expect(refreshing()).toBe(false);

    for (const refetching of [true, false, true, false]) {
      mockIsRefetching = refetching;
      feed.rerenderFeed();
      expect(refreshing()).toBe(false);
    }

    let finishRefetch: () => void = () => {};
    mockSummaryRefetch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefetch = resolve;
        })
    );
    let pull: Promise<void> | undefined;
    act(() => {
      pull = list.props.refreshControl.props.onRefresh();
    });
    expect(refreshing()).toBe(true);

    await act(async () => {
      finishRefetch();
      await pull;
    });
    expect(refreshing()).toBe(false);
  });

  it('asks the engine for a sync', async () => {
    renderFeed();
    const list = await screen.findByTestId('home-activity-list');
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });
    expect(requestSyncRefresh).toHaveBeenCalledTimes(1);
  });
});
