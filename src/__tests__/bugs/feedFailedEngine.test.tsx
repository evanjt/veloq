/**
 * Scenario: the engine gave up opening, so the feed's read answers with the
 * closed engine's empty default and the library on the device is untouched.
 * Expected behaviour: the feed says the library could not be opened, with the
 * engine's reason and a Retry that re-runs the open, and never says there are
 * no activities.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import FeedScreen from '@/app/(tabs)/(feed)';
import { InitOutcome } from 'veloqrs';

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
  useIsFocused: () => true,
  Stack: require('../__shared__/nativeHeaderStandIn').Stack,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useTopSafeArea: () => ({ screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({ decodeCoords: () => [] })
);
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
const mockEngineOpen = { value: false };
jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
  isEngineReady: () => mockEngineOpen.value,
  getNativeModule: () => null,
  getRouteDbPath: () => null,
}));
jest.mock('@/features/activity/hooks', () => ({
  ...jest.requireActual('@/features/activity/hooks'),
  useInfiniteActivities: () => ({
    data: { pages: [[]] },
    isLoading: false,
    isError: false,
    error: null,
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

function renderFeed() {
  (getEngine as jest.Mock).mockReturnValue({
    getActivityHighlightsBundle: () => ({ indicators: [], routeHighlights: [], newGround: [] }),
    searchFeedCards: () => ({ cards: [], matchedCount: 0, hasMore: false }),
    getSyncStatus: () => ({ state: 0, inFlight: 0, completed: 0, total: 0 }),
    subscribe: () => () => {},
  });
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FeedScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockEngineOpen.value = false;
  useEngineStatus.setState({ initFailed: false, initFailureReason: null, retryNonce: 0 });
});

it('says why the library could not be opened, not that there are no activities', () => {
  useEngineStatus.setState({ initFailed: true, initFailureReason: InitOutcome.Busy });
  renderFeed();
  expect(screen.queryByText('feed.emptyLibrary.emptyTitle')).toBeNull();
  expect(screen.getByText('engine.initReason.busy')).toBeTruthy();

  fireEvent.press(screen.getByText('common.retry'));
  expect(useEngineStatus.getState().retryNonce).toBe(1);
});

it('keeps the skeletons while the engine is still opening', () => {
  renderFeed();
  expect(screen.queryByText('feed.emptyLibrary.emptyTitle')).toBeNull();
  expect(screen.getByTestId('home-loading-skeletons')).toBeTruthy();
});

it('says there are no activities only once the engine is open', () => {
  mockEngineOpen.value = true;
  renderFeed();
  expect(screen.getByText('feed.emptyLibrary.emptyTitle')).toBeTruthy();
});
