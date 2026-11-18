/**
 * Scenario: the feed opens with its filter section scrolled exactly past, so the
 * cards above the activities sit at the top of the list.
 * Expected behaviour: the space under the head cards is the space between cards,
 * with the filter section hidden or shown, and the space either side of a shown
 * filter section is the same. Settings is a tab, so the feed draws no way into
 * it, with the summary card on or off.
 *
 * Scenario: the feed shows the summary card and its notices at any text size.
 * Expected behaviour: they are part of the list, below the filter section, and
 * scroll away with the feed like an activity card. The feed opens scrolled past
 * the filter section alone, so the summary card is the first thing on screen, and
 * a search typed into the header opens the list at the filter section.
 *
 * Scenario: the feed shows a card above its activities.
 * Expected behaviour: every head card sits in the one container that insets the
 * column by the activity card's margin, so the cards and the list share one edge.
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
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
  const cards = StyleSheet.flatten(screen.getByTestId('home-head-cards').props.style);
  return { cardsBottom: cards.paddingBottom ?? 0 };
}

describe('feed gap under the head cards', () => {
  vaultIt('leaves the card spacing above the first card', async () => {
    const { cardsBottom } = await renderFeed();
    expect(cardsBottom).toBe(CARD_MARGIN);
  });
});

describe('feed head card column', () => {
  vaultIt('insets every head card by the activity card margin', async () => {
    await renderFeed();
    const cards = screen.getByTestId('home-head-cards');
    expect(StyleSheet.flatten(cards.props.style).paddingHorizontal).toBe(CARD_MARGIN);
    for (const card of ['stand-in-stream-consent-card', 'stand-in-pending-uploads-card']) {
      expect(within(cards).getByTestId(card)).toBeTruthy();
    }
  });
});

/** The test ids in the rendered tree, in the order they are drawn. */
function drawOrder(): string[] {
  const ids: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const { props, children } = node as { props?: { testID?: string }; children?: unknown };
    if (props?.testID) ids.push(props.testID);
    walk(children);
  };
  walk(screen.toJSON());
  return ids;
}

describe.each([1, 2])('feed head cards at font scale %s', (fontScale) => {
  afterEach(() => jest.restoreAllMocks());

  vaultIt('scrolls the cards with the list', async () => {
    await renderFeed(fontScale);
    const list = screen.getByTestId('home-activity-list');
    expect(within(list).getByTestId('home-head-cards')).toBeTruthy();
  });

  vaultIt('opens the list at its first card with nothing scrolled past', async () => {
    await renderFeed(fontScale);
    expect(screen.getByTestId('home-activity-list').props.contentOffset).toBeUndefined();
  });

  vaultIt('draws no filter panel while nothing is set and it is shut', async () => {
    await renderFeed(fontScale);
    expect(screen.queryByTestId('home-filter-panel')).toBeNull();
  });

  vaultIt('pins the filter panel above the list, outside it', async () => {
    await renderFeed(fontScale);
    await fireEvent.press(screen.getByTestId('home-filter-button'));

    const panel = screen.getByTestId('home-filter-panel');
    const list = screen.getByTestId('home-activity-list');
    expect(within(list).queryByTestId('home-filter-panel')).toBeNull();
    const order = drawOrder();
    expect(order.indexOf('home-filter-panel')).toBeLessThan(order.indexOf('home-activity-list'));
    expect(panel).toBeTruthy();
  });

  vaultIt('opens the panel when the search field takes focus', async () => {
    await renderFeed(fontScale);
    await fireEvent(screen.getByTestId('native-header-search'), 'focus');
    expect(screen.getByTestId('home-filter-panel')).toBeTruthy();
  });

  vaultIt('collapses the open panel to chips once the list is dragged', async () => {
    await renderFeed(fontScale);
    await fireEvent.press(screen.getByTestId('home-filter-button'));
    await fireEvent.press(screen.getByTestId('home-filter-run'));
    expect(screen.getByTestId('home-filter-run')).toBeTruthy();

    await fireEvent(screen.getByTestId('home-activity-list'), 'scrollBeginDrag');

    expect(screen.queryByTestId('home-filter-run')).toBeNull();
    expect(screen.getByTestId('home-filter-chip-sport-run')).toBeTruthy();
  });

  vaultIt('clears one filter from its chip and drops the panel once none is left', async () => {
    await renderFeed(fontScale);
    await fireEvent.press(screen.getByTestId('home-filter-button'));
    await fireEvent.press(screen.getByTestId('home-filter-run'));
    await fireEvent.press(screen.getByTestId('home-filter-panel-close'));

    await fireEvent.press(screen.getByTestId('home-filter-chip-sport-run-clear'));

    expect(screen.queryByTestId('home-filter-panel')).toBeNull();
  });
});

describe('feed settings control', () => {
  const initial = useDashboardPreferences.getState().summaryCard;
  afterEach(() => useDashboardPreferences.setState({ summaryCard: initial }));

  vaultIt.each([false, true])(
    'draws no way into Settings with the summary card %s, since Settings is a tab',
    async (enabled) => {
      useDashboardPreferences.setState({ summaryCard: { ...initial, enabled } });
      await renderFeed();
      expect(screen.queryByLabelText('navigation.settings')).toBeNull();
      expect(screen.queryByLabelText('common.openSettings')).toBeNull();
    }
  );
});
