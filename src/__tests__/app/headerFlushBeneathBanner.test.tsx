/**
 * Scenario: a banner fills the top slot, which pads the status bar and pushes the stack down
 * beneath it. Every stack screen's native header and every screen reading the safe area used to
 * take the status-bar inset again, so a band the height of the status bar opened between the
 * banner and the header.
 *
 * Expected behaviour: beneath a filled slot the stack sees no top inset, so the header starts
 * flush under the banner, and a modal, which covers the whole window, still clears the status bar.
 */
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';

import TabsLayout from '@/app/(tabs)/_layout';
import FeedLayout from '@/app/(tabs)/(feed)/_layout';
import { BeneathTopSlot, TopSafeAreaProvider } from '@/shared/app/TopSafeAreaContext';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';
import { act, renderRouter, screen } from 'expo-router/testing-library';

jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router') }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true, offlineBannerShown: false }),
}));
jest.mock('@/shared/native/useSyncHealth', () => ({
  useSyncHealth: () => ({ lastError: null, lastSuccessAt: null }),
}));

const STATUS_BAR = 47;
const WINDOW = { top: STATUS_BAR, bottom: 34, left: 0, right: 0 };

let bannerShown = false;

function Root() {
  return (
    <SafeAreaInsetsContext.Provider value={WINDOW}>
      <TopSafeAreaProvider startupErrorShown={bannerShown}>
        <BeneathTopSlot>
          <Stack screenOptions={{ headerShown: false }} />
        </BeneathTopSlot>
      </TopSafeAreaProvider>
    </SafeAreaInsetsContext.Provider>
  );
}

function FeedRoot() {
  return <Text testID="feed-header-height">{useHeaderHeight()}</Text>;
}

function InsetReport({ testID }: { testID: string }) {
  return <Text testID={testID}>{useSafeAreaInsets().top}</Text>;
}

function MapRoot() {
  return (
    <>
      <InsetReport testID="map-top" />
      <FullWindowModal visible>
        <InsetReport testID="modal-top" />
      </FullWindowModal>
    </>
  );
}

const APP = {
  _layout: Root,
  '(tabs)/_layout': TabsLayout,
  '(tabs)/(feed)/_layout': FeedLayout,
  '(tabs)/(feed)/index': FeedRoot,
  '(tabs)/map': MapRoot,
};

function reading(testID: string): number {
  return Number(screen.getByTestId(testID).props.children);
}

async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(200);
  });
}

async function feedHeaderHeight(): Promise<number> {
  renderRouter(APP, { initialUrl: '/' });
  await settle();
  return reading('feed-header-height');
}

beforeEach(() => {
  bannerShown = false;
});

describe('the stack beneath the top slot', () => {
  it('draws a tab root header flush under a banner rather than padding the status bar again', async () => {
    const underStatusBar = await feedHeaderHeight();
    screen.unmount();
    bannerShown = true;
    const underBanner = await feedHeaderHeight();

    expect(underStatusBar).toBeGreaterThan(STATUS_BAR);
    expect(underBanner).toBe(underStatusBar - STATUS_BAR);
  });

  it('gives a headerless screen no top inset under a banner, and the window inset when the slot is empty', async () => {
    bannerShown = true;
    renderRouter(APP, { initialUrl: '/' });
    await settle();
    await act(() => router.navigate('/map'));
    await settle();
    expect(reading('map-top')).toBe(0);
    screen.unmount();

    bannerShown = false;
    renderRouter(APP, { initialUrl: '/' });
    await settle();
    await act(() => router.navigate('/map'));
    await settle();
    expect(reading('map-top')).toBe(STATUS_BAR);
  });

  it('gives a modal the whole window inset, since it covers the banner and the status bar', async () => {
    bannerShown = true;
    renderRouter(APP, { initialUrl: '/' });
    await settle();
    await act(() => router.navigate('/map'));
    await settle();

    expect(reading('modal-top')).toBe(STATUS_BAR);
  });
});
