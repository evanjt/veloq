/**
 * Scenario: an install upgraded from a build that kept a list of activities
 * the background task had ingested still holds that list in AsyncStorage.
 * Expected behaviour: the snapshot pool mounts after its 500 ms defer on every
 * open, whatever the stale list holds.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FeedScreen from '@/app/(tabs)/(feed)';

jest.mock('@/shared/native/syncRefresh', () => ({
  requestSyncRefresh: jest.fn(),
  cancelSyncRefresh: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: require('../__shared__/nativeHeaderStandIn').Stack,
  useIsFocused: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useTopSafeArea: () => ({ screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({ decodeCoords: () => [] })
);
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
  isEngineReady: () => true,
  getNativeModule: () => null,
  getRouteDbPath: () => null,
}));
jest.mock('@/features/activity/hooks', () => ({
  ...jest.requireActual('@/features/activity/hooks'),
  useInfiniteActivities: () => ({
    data: { pages: [[]] },
    isLoading: false,
    isError: false,
    isRefetching: false,
    fetchNextPage: jest.fn(),
    fetchPreviousPage: jest.fn(),
    hasPreviousPage: false,
    isFetchingPreviousPage: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/features/insights', () => ({ useInsights: () => ({ insights: [] }) }));
jest.mock('@/features/home', () => ({
  ...jest.requireActual('@/features/settings/stores/summaryCardPreferences'),
  feedEmptyState: jest.requireActual('@/features/home/lib/feedEmptyState').feedEmptyState,
  FeedEmptyLibrary: jest.requireActual('@/features/home/components/FeedEmptyLibrary')
    .FeedEmptyLibrary,
  summaryCardTarget: jest.requireActual('@/features/home/lib/summaryCardTargets').summaryCardTarget,
  useSummaryCardData: () => ({ showSparkline: false, refetch: jest.fn() }),
  useStartupData: () => ({ data: undefined, refresh: jest.fn() }),
  SummaryCard: () => null,
  SupportCard: () => null,
}));
jest.mock('@/features/recording', () => ({
  RecordFAB: () => null,
  PendingUploadsCard: () => null,
}));
const mockPoolMounted = jest.fn();
const mockHoldForScroll = jest.fn();
jest.mock('@/features/maps/components/TerrainSnapshotWebView', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react');
  return {
    TerrainSnapshotWebView: forwardRef(function MockPool(_props: unknown, ref: unknown) {
      mockPoolMounted();
      useImperativeHandle(ref, () => ({
        requestSnapshot: jest.fn(),
        retryFailed: jest.fn(),
        holdForScroll: mockHoldForScroll,
      }));
      return null;
    }),
  };
});
jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  ...jest.requireActual('@/features/maps/lib/storage/terrainPreviewCache'),
  initTerrainPreviewCache: jest.fn(),
}));
jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  initCameraOverrides: jest.fn(),
}));
jest.mock('@/features/activity/components', () => ({ ActivityCard: () => null }));

const PENDING_KEY = 'veloq-pending-terrain-snapshots';

beforeEach(() => {
  jest.useFakeTimers();
  mockPoolMounted.mockClear();
  mockHoldForScroll.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

const renderFeed = async () => {
  (getEngine as jest.Mock).mockReturnValue({
    getActivityHighlightsBundle: () => ({ indicators: [], routeHighlights: [] }),
    searchActivityBodies: () => ({ bodies: [], intervalsIds: [], matchedCount: 0, hasMore: false }),
    getSyncStatus: () => ({ state: 0, inFlight: 0, completed: 0, total: 0 }),
    subscribe: () => () => {},
  });
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <FeedScreen />
    </QueryClientProvider>
  );
};

it('mounts the snapshot pool only after its defer, with a stale pending list stored', async () => {
  await AsyncStorage.setItem(
    PENDING_KEY,
    JSON.stringify([{ activityId: 'i1', timestamp: Date.now() }])
  );
  await renderFeed();

  await act(async () => {
    await jest.advanceTimersByTimeAsync(499);
  });
  expect(mockPoolMounted).not.toHaveBeenCalled();

  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(mockPoolMounted).toHaveBeenCalled();
});

/**
 * Scenario: the athlete flings the feed once the pool is up.
 * Expected behaviour: the pool is held from the drag until the fling settles,
 * so no map render starts under the scroll.
 */
it('holds the snapshot pool from a drag until its fling settles', async () => {
  await renderFeed();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  const list = screen.getByTestId('home-activity-list');
  const fling = { nativeEvent: { velocity: { x: 0, y: 2 } } };

  await fireEvent(list, 'scrollBeginDrag', fling);
  await fireEvent(list, 'scrollEndDrag', fling);
  await fireEvent(list, 'momentumScrollBegin', fling);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1000);
  });

  expect(mockHoldForScroll.mock.calls).toEqual([[true], [true]]);

  await fireEvent(list, 'momentumScrollEnd', fling);

  expect(mockHoldForScroll.mock.calls).toEqual([[true], [true], [false]]);
});
