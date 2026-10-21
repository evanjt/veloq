/**
 * Scenario: the feed's activity read throws an Error whose text is English
 * and built in the engine, or a search matches no activities.
 * Expected behaviour: the error state shows the translated failure line and
 * never the thrown message. A search with no match draws the shared EmptyState.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
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
const mockFeedRead = { isError: true };
jest.mock('@/features/activity/hooks', () => ({
  ...jest.requireActual('@/features/activity/hooks'),
  useInfiniteActivities: () => ({
    data: { pages: [[]] },
    isLoading: false,
    isError: mockFeedRead.isError,
    error: mockFeedRead.isError ? new Error('engine read failed: SQLITE_BUSY') : null,
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
jest.mock('@/features/maps/components/TerrainSnapshotWebView', () => ({
  TerrainSnapshotWebView: () => null,
}));
jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  initTerrainPreviewCache: jest.fn(),
}));
jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  initCameraOverrides: jest.fn(),
}));
jest.mock('@/features/activity/components', () => ({ ActivityCard: () => null }));

async function renderFeed() {
  (getEngine as jest.Mock).mockReturnValue({
    getActivityHighlightsBundle: () => ({ indicators: [], routeHighlights: [], newGround: [] }),
    searchFeedCards: () => ({ cards: [], matchedCount: 0, hasMore: false }),
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
}

it('shows the translated failure line, not the thrown message', async () => {
  mockFeedRead.isError = true;
  await renderFeed();
  expect(screen.getByText('feed.failedToLoad')).toBeTruthy();
  expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
});

it('draws the shared empty state for a search that matches nothing', async () => {
  mockFeedRead.isError = false;
  await renderFeed();
  await fireEvent.changeText(screen.getByTestId('native-header-search'), 'nowhere');
  await waitFor(() => expect(screen.getByTestId('home-empty-state-title')).toBeTruthy());
  expect(screen.getByTestId('home-empty-state-title').props.children).toMatch(
    /^feed\.noActivitiesFor/
  );
});

it("stacks the search field under the title, clear of the app's own tab bar", async () => {
  mockFeedRead.isError = false;
  await renderFeed();
  expect(screen.getByTestId('native-header-search').props.accessibilityHint).toBe('stacked');
});
