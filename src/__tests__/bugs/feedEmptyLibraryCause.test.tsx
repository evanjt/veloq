/**
 * Scenario: a fresh install whose first sync stored nothing. It was paused,
 * intervals.icu refused the login, the server could not be reached, or the
 * account really holds no activities.
 *
 * Expected behaviour: the feed names the cause with the action that fills it,
 * and never tells an athlete whose sync failed that they have no activities.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncErrorReason, SyncState } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { navigateTo } from '@/shared/app/navigation';
import { useAuthStore } from '@/shared/app/AuthStore';
import FeedScreen from '@/app/(tabs)/(feed)';

jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTo: jest.fn(),
}));
jest.mock('@/shared/native/syncRefresh', () => ({
  requestSyncRefresh: jest.fn(() => require('veloqrs').StartOutcome.Started),
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

async function renderFeedAfterSync(state: SyncState, lastErrorReason: SyncErrorReason | null) {
  (getEngine as jest.Mock).mockReturnValue({
    getActivityHighlightsBundle: () => ({ indicators: [], routeHighlights: [], newGround: [] }),
    searchFeedCards: () => ({ cards: [], matchedCount: 0, hasMore: false }),
    getSyncStatus: () => ({
      state,
      inFlight: 0,
      completed: 0,
      total: 0,
      lastError: lastErrorReason === null ? undefined : 'sync failed',
      lastErrorReason: lastErrorReason ?? undefined,
    }),
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

beforeEach(() => {
  jest.clearAllMocks();
});

it('names an unreachable server and retries the sync', async () => {
  await renderFeedAfterSync(SyncState.Idle, SyncErrorReason.Network);

  expect(screen.getByText('feed.emptyLibrary.failedTitle')).toBeTruthy();
  expect(screen.getByText('emptyState.syncError.reason.network')).toBeTruthy();
  expect(screen.queryByText('feed.emptyLibrary.emptyTitle')).toBeNull();

  await fireEvent.press(screen.getByText('common.retry'));
  expect(requestSyncRefresh).toHaveBeenCalledTimes(1);
});

it('sends a refused login to sign in again', async () => {
  await renderFeedAfterSync(SyncState.AuthExpired, SyncErrorReason.Unauthorized);

  expect(screen.getByText('feed.emptyLibrary.authExpiredTitle')).toBeTruthy();
  expect(screen.queryByText('feed.emptyLibrary.emptyTitle')).toBeNull();

  await fireEvent.press(screen.getByText('feed.emptyLibrary.signInAgain'));
  expect(navigateTo).toHaveBeenCalledWith('/login');
});

it('says a rate-limited sync is waiting, with nothing to press', async () => {
  await renderFeedAfterSync(SyncState.Idle, SyncErrorReason.RateLimited);

  expect(screen.getByText('feed.emptyLibrary.pausedTitle')).toBeTruthy();
  expect(screen.getByText('emptyState.syncError.reason.rateLimited')).toBeTruthy();
  expect(screen.queryByText('common.retry')).toBeNull();
});

it('says a paused sync resumes', async () => {
  await renderFeedAfterSync(SyncState.Paused, null);

  expect(screen.getByText('feed.emptyLibrary.pausedTitle')).toBeTruthy();
  expect(screen.getByText('feed.emptyLibrary.pausedBody')).toBeTruthy();
});

it('tells an account with no activities where they come from and offers to record', async () => {
  await renderFeedAfterSync(SyncState.Idle, null);

  expect(screen.getByText('feed.emptyLibrary.emptyTitle')).toBeTruthy();
  expect(screen.getByText('feed.emptyLibrary.emptyBody')).toBeTruthy();

  await fireEvent.press(screen.getByText('feed.emptyLibrary.record'));
  expect(navigateTo).toHaveBeenCalledWith('/record');
});
