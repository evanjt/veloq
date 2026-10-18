/**
 * Scenario: the notices over a map were a centred card (the map empty state) and a banner in the
 * top slot that pushed every screen down (the missing-tracks notice), because the floating pill
 * had no shape for a notice the athlete can act on or close.
 *
 * Expected behaviour: the floating pill takes a labelled action and a close. The empty map and
 * the missing-tracks notice draw as that pill in the bottom pill stack, their action and close
 * fire, and the missing-tracks notice no longer claims the top slot or its inset.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { FfiMapEmptyReason_Tags, type FfiMapEmptyReason } from 'veloqrs';

import { MapEmptyState, MAP_EMPTY_STATE_TEST_ID } from '@/features/maps/components/MapEmptyState';
import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { navigateTo } from '@/shared/app/navigation';
import { TopSafeAreaProvider, useTopSafeArea } from '@/shared/app/TopSafeAreaContext';
import { useTopBannerHeights } from '@/shared/app/topBanner';
import { BottomPillStack } from '@/shared/ui/BottomPillStack';
import { useBottomPills } from '@/shared/ui/bottomPills';
import { FloatingPill } from '@/shared/ui/FloatingPill';
import { TrackFetchNotice } from '@/shared/ui/TrackFetchNotice';
import { layout } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/native/useSyncHealth', () => ({
  useSyncHealth: () => ({ lastError: null, retryAtMs: null }),
}));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true, offlineBannerShown: false }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useSegments: () => ['(tabs)'],
  usePathname: () => '/',
  useIsFocused: () => true,
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 40, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

type Rendered = Awaited<ReturnType<typeof render>>;

function isPill(view: Rendered, testID: string): boolean {
  const style = StyleSheet.flatten(view.getByTestId(testID).props.style);
  return style.borderRadius === layout.borderRadiusFull;
}

async function layOut(view: Rendered, testID: string, height: number) {
  await act(() =>
    fireEvent(view.getByTestId(testID), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
    })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useBottomPills.setState({ heights: {}, covers: {} });
  useTopBannerHeights.setState({ heights: {} });
  useTrackFetchNotice.setState({ failedIds: [], failedCount: 0, dismissed: false });
});

describe('the floating pill with an action and a close', () => {
  function notice(onAction = jest.fn(), onDismiss = jest.fn()) {
    return (
      <FloatingPill
        icon="lighthouse"
        title="Lamp out"
        detail="The keeper is on the way"
        action={{ label: 'Call the keeper', onPress: onAction, testID: 'lamp-call' }}
        onDismiss={onDismiss}
        testID="lamp"
      />
    );
  }

  it('draws its action as a button named by its label, and runs it on a press', async () => {
    const onAction = jest.fn();
    const view = await render(notice(onAction));

    const action = view.getByTestId('lamp-call');
    expect(action.props.accessibilityRole).toBe('button');
    expect(view.getByText('Call the keeper')).toBeTruthy();
    await fireEvent.press(action);

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('closes on its labelled close', async () => {
    const onDismiss = jest.fn();
    const view = await render(notice(jest.fn(), onDismiss));

    const close = view.getByTestId('lamp-dismiss');
    expect(close.props.accessibilityLabel).toBe('common.close');
    await fireEvent.press(close);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stays the pill, speaks as it appears and lets the map under it take every other touch', async () => {
    const view = await render(notice());

    const pill = view.getByTestId('lamp');
    expect(isPill(view, 'lamp')).toBe(true);
    expect(pill.props.accessibilityLiveRegion).toBe('polite');
    expect(pill.props.pointerEvents).toBe('box-none');
  });

  it('draws no close and no action when it is given neither', async () => {
    const view = await render(<FloatingPill icon="lighthouse" title="Lamp out" testID="lamp" />);

    expect(view.queryByTestId('lamp-dismiss')).toBeNull();
    expect(view.getByTestId('lamp').props.pointerEvents).toBe('none');
  });
});

describe('the missing-tracks notice', () => {
  it('draws as the pill in the bottom stack', async () => {
    useTrackFetchNotice.setState({ failedIds: ['a', 'b'], failedCount: 2, dismissed: false });
    const view = await render(<BottomPillStack pills={{ trackFetch: <TrackFetchNotice /> }} />);
    await layOut(view, 'bottom-pill-trackFetch', 48);

    expect(isPill(view, 'track-fetch-notice')).toBe(true);
    expect(useBottomPills.getState().heights.trackFetch).toBe(48);
  });

  it('takes no place in the top slot and leaves screens their top inset', async () => {
    useTrackFetchNotice.setState({ failedIds: ['a', 'b'], failedCount: 2, dismissed: false });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TopSafeAreaProvider>{children}</TopSafeAreaProvider>
    );
    const view = await render(<TrackFetchNotice />, { wrapper });
    await layOut(view, 'track-fetch-notice', 48);
    const { result } = await renderHook(() => useTopSafeArea(), { wrapper });

    expect(result.current.hasTopBanner).toBe(false);
    expect(result.current.screenEdges).toContain('top');
    expect(useTopBannerHeights.getState().heights).toEqual({});
  });

  it('opens the one activity whose track failed, and comes down when closed', async () => {
    useTrackFetchNotice.setState({ failedIds: ['i42'], failedCount: 1, dismissed: false });
    const view = await render(<TrackFetchNotice />);

    await fireEvent.press(view.getByTestId('track-fetch-notice-open'));
    expect(navigateTo).toHaveBeenCalledWith('/activity/i42');

    await fireEvent.press(view.getByTestId('track-fetch-notice-dismiss'));
    expect(view.queryByTestId('track-fetch-notice')).toBeNull();
  });
});

describe('the empty map', () => {
  function empty(reason: FfiMapEmptyReason, handlers: Partial<Record<string, jest.Mock>> = {}) {
    return (
      <MapEmptyState
        reason={reason}
        allTime={false}
        onShowAllTime={handlers.showAllTime ?? jest.fn()}
        onExpandRange={jest.fn()}
        onClearFilters={handlers.clearFilters ?? jest.fn()}
      />
    );
  }

  it('draws as the pill in the bottom stack and offers the whole library', async () => {
    const showAllTime = jest.fn();
    const view = await render(
      empty({ tag: FfiMapEmptyReason_Tags.NoActivities } as FfiMapEmptyReason, { showAllTime })
    );
    await layOut(view, 'bottom-pill-mapEmpty', 52);

    expect(isPill(view, MAP_EMPTY_STATE_TEST_ID)).toBe(true);
    expect(useBottomPills.getState().heights.mapEmpty).toBe(52);
    await fireEvent.press(view.getByTestId(`${MAP_EMPTY_STATE_TEST_ID}-action`));
    expect(showAllTime).toHaveBeenCalledTimes(1);
  });

  it('clears the filters that hide every track', async () => {
    const clearFilters = jest.fn();
    const view = await render(
      empty({ tag: FfiMapEmptyReason_Tags.Filtered, inner: { mapped: 4 } } as FfiMapEmptyReason, {
        clearFilters,
      })
    );

    await fireEvent.press(view.getByTestId(`${MAP_EMPTY_STATE_TEST_ID}-action`));
    expect(clearFilters).toHaveBeenCalledTimes(1);
  });

  it('offers nothing to press while the tracks download', async () => {
    const view = await render(
      empty({
        tag: FfiMapEmptyReason_Tags.TracksPending,
        inner: { pending: 3 },
      } as FfiMapEmptyReason)
    );

    expect(isPill(view, MAP_EMPTY_STATE_TEST_ID)).toBe(true);
    expect(view.queryByTestId(`${MAP_EMPTY_STATE_TEST_ID}-action`)).toBeNull();
    expect(view.getByText('mapScreen.emptyTracksPending')).toBeTruthy();
  });

  it('gives up its place in the stack when the map draws again', async () => {
    const view = await render(empty({ tag: FfiMapEmptyReason_Tags.NoGps } as FfiMapEmptyReason));
    await layOut(view, 'bottom-pill-mapEmpty', 52);

    await view.unmount();

    expect(useBottomPills.getState().heights.mapEmpty).toBeUndefined();
  });
});
