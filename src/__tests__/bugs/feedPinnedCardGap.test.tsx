/**
 * Scenario: the feed opens with its search section scrolled exactly past, so the
 * first activity card sits at the top of the list, under the pinned summary card.
 * Expected behaviour: the space above the first card is the space between cards,
 * with the search section hidden or shown, and the space either side of a shown
 * search section is the same.
 *
 * Scenario: the system text size is past the dense cap, where the pinned cards
 * alone can fill the window and leave the list no height.
 * Expected behaviour: the cards scroll with the feed, above the search section,
 * and the feed opens scrolled past both so the first activity is on screen.
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { FlatList, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { CARD_MARGIN } from '@/features/activity/lib/cardLayout';
import FeedScreen from '@/app/(tabs)/index';

const mockFontScale = { current: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ width: 430, height: 932, scale: 3, fontScale: mockFontScale.current }),
}));
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
}));
jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  initCameraOverrides: jest.fn(),
}));
jest.mock('@/features/activity/components', () => ({ ActivityCard: () => null }));

function renderFeed(fontScale = 1) {
  mockFontScale.current = fontScale;
  (getEngine as jest.Mock).mockReturnValue({
    getActivityHighlightsBundle: () => ({ indicators: [], routeHighlights: [], newGround: [] }),
    searchActivityBodies: () => ({ bodies: [], matchedCount: 0, hasMore: false }),
    getSyncStatus: () => ({ state: 0, inFlight: 0, completed: 0, total: 0 }),
    subscribe: () => () => {},
  });
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FeedScreen />
    </QueryClientProvider>
  );
  const pinned = StyleSheet.flatten(screen.getByTestId('home-pinned-cards').props.style);
  const search = StyleSheet.flatten(screen.getByTestId('home-search-section').props.style);
  return {
    pinnedBottom: pinned.paddingBottom ?? 0,
    searchTop: search.paddingTop ?? 0,
    searchBottom: search.paddingBottom ?? 0,
  };
}

describe('feed gap under the pinned cards', () => {
  it('leaves the card spacing above the first card when the search section is hidden', () => {
    const { pinnedBottom } = renderFeed();
    expect(pinnedBottom).toBe(CARD_MARGIN);
  });

  it('leaves the card spacing above and below a shown search section', () => {
    const { pinnedBottom, searchTop, searchBottom } = renderFeed();
    expect(pinnedBottom + searchTop).toBe(CARD_MARGIN);
    expect(searchBottom).toBe(CARD_MARGIN);
  });
});

describe('feed pinned cards at large text', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the cards pinned above the list at the default size', () => {
    renderFeed(1);
    const list = screen.getByTestId('home-activity-list');
    expect(within(list).queryByTestId('home-pinned-cards')).toBeNull();
  });

  it('scrolls the cards with the list past the dense cap', () => {
    renderFeed(2);
    const list = screen.getByTestId('home-activity-list');
    expect(within(list).getByTestId('home-pinned-cards')).toBeTruthy();
  });

  it('opens scrolled past the cards and the search section together', () => {
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    renderFeed(2);
    fireEvent(screen.getByTestId('home-search-section'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 640, width: 430, height: 86 } },
    });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 726, animated: false });
  });

  it('opens scrolled past the search section alone while the cards are pinned', () => {
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    renderFeed(1);
    fireEvent(screen.getByTestId('home-search-section'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 430, height: 86 } },
    });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 86, animated: false });
  });
});
