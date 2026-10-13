/**
 * Scenario: the feed opens with its filter section scrolled exactly past, so the
 * first activity card sits at the top of the list, under the pinned summary card.
 * Expected behaviour: the space above the first card is the space between cards,
 * with the filter section hidden or shown, and the space either side of a shown
 * filter section is the same. Settings is reachable on the first frame: with the
 * summary card off, its control sits in the native header rather than in the
 * section the list opens scrolled past.
 *
 * Scenario: the system text size is past the dense cap, where the pinned cards
 * alone can fill the window and leave the list no height.
 * Expected behaviour: the cards scroll with the feed, above the filter section,
 * and the feed opens scrolled past both so the first activity is on screen. A
 * search typed into the header opens the list at the filter section, not at the
 * cards above it.
 *
 * Scenario: the feed shows a pinned card above the activity list.
 * Expected behaviour: every pinned card sits in the one container that insets the
 * column by the activity card's margin, so the cards and the list share one edge.
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { FlatList, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getEngine } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useDashboardPreferences } from '@/features/settings';
import { CARD_MARGIN } from '@/features/activity/lib/cardLayout';
import FeedScreen from '@/app/(tabs)/(feed)';

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
  NotificationOptInCard: () => {
    const { View: Pinned } = jest.requireActual('react-native');
    return <Pinned testID="stand-in-notification-card" />;
  },
  SupportCard: () => null,
}));
jest.mock('@/features/settings/components/StreamConsentCard', () => ({
  StreamConsentCard: () => {
    const { View: Pinned } = jest.requireActual('react-native');
    return <Pinned testID="stand-in-stream-consent-card" />;
  },
}));
jest.mock('@/features/recording', () => ({
  RecordFAB: () => null,
  PendingUploadsCard: () => {
    const { View: Pinned } = jest.requireActual('react-native');
    return <Pinned testID="stand-in-pending-uploads-card" />;
  },
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

async function renderFeed(fontScale = 1) {
  mockFontScale.current = fontScale;
  (getEngine as jest.Mock).mockReturnValue({
    getActivityHighlightsBundle: () => ({ indicators: [], routeHighlights: [], newGround: [] }),
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
  const pinned = StyleSheet.flatten(screen.getByTestId('home-pinned-cards').props.style);
  const search = StyleSheet.flatten(screen.getByTestId('home-filter-section').props.style);
  return {
    pinnedBottom: pinned.paddingBottom ?? 0,
    searchTop: search.paddingTop ?? 0,
    searchBottom: search.paddingBottom ?? 0,
  };
}

describe('feed gap under the pinned cards', () => {
  it('leaves the card spacing above the first card when the filter section is hidden', async () => {
    const { pinnedBottom } = await renderFeed();
    expect(pinnedBottom).toBe(CARD_MARGIN);
  });

  it('leaves the card spacing above and below a shown filter section', async () => {
    const { pinnedBottom, searchTop, searchBottom } = await renderFeed();
    expect(pinnedBottom + searchTop).toBe(CARD_MARGIN);
    expect(searchBottom).toBe(CARD_MARGIN);
  });
});

describe('feed pinned card column', () => {
  it('insets every pinned card by the activity card margin', async () => {
    await renderFeed();
    const pinned = screen.getByTestId('home-pinned-cards');
    expect(StyleSheet.flatten(pinned.props.style).paddingHorizontal).toBe(CARD_MARGIN);
    for (const card of [
      'stand-in-stream-consent-card',
      'stand-in-notification-card',
      'stand-in-pending-uploads-card',
    ]) {
      expect(within(pinned).getByTestId(card)).toBeTruthy();
    }
  });
});

describe('feed pinned cards at large text', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the cards pinned above the list at the default size', async () => {
    await renderFeed(1);
    const list = screen.getByTestId('home-activity-list');
    expect(within(list).queryByTestId('home-pinned-cards')).toBeNull();
  });

  it('scrolls the cards with the list past the dense cap', async () => {
    await renderFeed(2);
    const list = screen.getByTestId('home-activity-list');
    expect(within(list).getByTestId('home-pinned-cards')).toBeTruthy();
  });

  it('opens scrolled past the cards and the filter section together', async () => {
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    await renderFeed(2);
    await fireEvent(screen.getByTestId('home-filter-section'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 640, width: 430, height: 86 } },
    });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 726, animated: false });
  });

  it('opens scrolled past the filter section alone while the cards are pinned', async () => {
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    await renderFeed(1);
    await fireEvent(screen.getByTestId('home-filter-section'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 430, height: 86 } },
    });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 86, animated: false });
  });

  it('opens a search typed into the header at the filter section below the cards', async () => {
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    await renderFeed(2);
    await fireEvent(screen.getByTestId('home-filter-section'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 640, width: 430, height: 42 } },
    });
    await fireEvent.changeText(screen.getByTestId('native-header-search'), 'ride');
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 640, animated: false });
  });
});

describe('feed settings control', () => {
  const initial = useDashboardPreferences.getState().summaryCard;
  afterEach(() => useDashboardPreferences.setState({ summaryCard: initial }));

  it('puts Settings in the header on the first frame when the summary card is off', async () => {
    useDashboardPreferences.setState({ summaryCard: { ...initial, enabled: false } });
    await renderFeed();
    const header = screen.getByTestId('native-header-right');
    expect(within(header).getByLabelText('navigation.settings')).toBeTruthy();
    const section = screen.getByTestId('home-filter-section');
    expect(within(section).queryByLabelText('navigation.settings')).toBeNull();
  });

  it('leaves the profile in the summary card when the card is on', async () => {
    useDashboardPreferences.setState({ summaryCard: { ...initial, enabled: true } });
    await renderFeed();
    expect(
      within(screen.getByTestId('native-header')).queryByLabelText('navigation.settings')
    ).toBeNull();
  });
});
