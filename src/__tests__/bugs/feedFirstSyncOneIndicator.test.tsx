/**
 * Scenario: a fresh install, its library still empty, partway through its first
 * sync. The feed draws its own first-sync view and the floating sync pill counts
 * the same steps above it.
 *
 * Expected behaviour: one indicator. While the feed's first-sync view is on
 * screen the pill steps aside; with the feed on another tab, or once the first
 * activity has landed, the pill shows the rest of the sync.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncState, SyncStep } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { SyncPill } from '@/shared/ui/SyncPill';
import FeedScreen from '@/app/(tabs)/(feed)';

let mockFocused = true;
let mockActivities: { id: string }[] = [];

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useIsFocused: () => mockFocused,
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
jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
  isEngineReady: () => true,
  getNativeModule: () => null,
  getRouteDbPath: () => null,
}));
jest.mock('@/features/activity/hooks', () => ({
  ...jest.requireActual('@/features/activity/hooks'),
  useInfiniteActivities: () => ({
    data: { pages: [mockActivities] },
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
  FeedFirstSyncStandby: jest.requireActual('@/features/home/components/FeedFirstSyncStandby')
    .FeedFirstSyncStandby,
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

async function renderFeedDuringFirstSync() {
  (getEngine as jest.Mock).mockReturnValue({
    getActivityHighlightsBundle: () => ({ indicators: [], routeHighlights: [], newGround: [] }),
    searchFeedCards: () => ({ cards: [], matchedCount: 0, hasMore: false }),
    getSyncStatus: () => ({
      state: SyncState.Syncing,
      inFlight: 1,
      completed: 4,
      total: 8,
      step: SyncStep.FirstActivities,
      stepItemsDone: 12,
      stepItemsTotal: 40,
    }),
    subscribe: () => () => {},
  });
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FeedScreen />
      <SyncPill />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockActivities = [];
});

it('shows only the first-sync view while the library is empty and the feed is in front', async () => {
  await renderFeedDuringFirstSync();

  expect(screen.getByTestId('feed-first-sync-standby')).toBeTruthy();
  expect(screen.queryByTestId('sync-progress-pill')).toBeNull();
});

it('shows the pill once the first activity has landed', async () => {
  mockActivities = [
    {
      id: 'a1',
      name: 'Harbour loop',
      type: 'Ride',
      start_date_local: '2026-01-02T08:00:00',
    } as unknown as { id: string },
  ];
  await renderFeedDuringFirstSync();

  expect(screen.queryByTestId('feed-first-sync-standby')).toBeNull();
  expect(screen.getByTestId('sync-progress-pill')).toBeTruthy();
});

it('shows the pill while the feed sits on another tab', async () => {
  mockFocused = false;
  await renderFeedDuringFirstSync();

  expect(screen.getByTestId('sync-progress-pill')).toBeTruthy();
});

it('gives the pill back when the feed unmounts', async () => {
  const { unmount } = await renderFeedDuringFirstSync();
  expect(screen.queryByTestId('sync-progress-pill')).toBeNull();

  await unmount();
  const pill = await render(<SyncPill />);

  expect(pill.getByTestId('sync-progress-pill')).toBeTruthy();
});
