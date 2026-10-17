/**
 * Scenario: a sync runs, or the device is offline, while a headered tab root is in
 * front. The pills mount at the root, above the stack, and float over the page.
 *
 * Expected behaviour: a pill starts `spacing.xs` below the status bar, over the
 * header the tab root draws rather than below its bottom edge, and below a banner
 * in the top slot when one is up. The map, which has no header, reads the same.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Stack, router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { SyncState, SyncStep } from 'veloqrs';

import TabsLayout from '@/app/(tabs)/_layout';
import FeedLayout from '@/app/(tabs)/(feed)/_layout';
import { useTopBannerHeights } from '@/shared/app/topBanner';
import { getEngine } from '@/shared/native/engine';
import { OfflineBanner } from '@/shared/ui/OfflineBanner';
import { SyncProgressStrip } from '@/shared/ui/SyncProgressStrip';
import { spacing } from '@/theme';
import { act, renderRouter, screen } from 'expo-router/testing-library';

// The shared setup stubs the router for render tests; this suite needs the real one.
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router') }));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: false, offlineBannerShown: true }),
}));

const TOP_INSET = 47;
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}));

const engine = {
  getSyncStatus: jest.fn(() => ({
    state: SyncState.Syncing,
    completed: 2,
    total: 10,
    step: SyncStep.Activities,
    stepItemsDone: 2,
    stepItemsTotal: 10,
  })),
  subscribe: jest.fn(() => () => {}),
};

function FeedRoot() {
  return <Text testID="feed-header-height">{useHeaderHeight()}</Text>;
}

function feedHeaderHeight(): number {
  return Number(screen.getByTestId('feed-header-height').props.children);
}

function Root() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <SyncProgressStrip />
      <OfflineBanner />
    </>
  );
}

const APP = {
  _layout: Root,
  '(tabs)/_layout': TabsLayout,
  '(tabs)/(feed)/_layout': FeedLayout,
  '(tabs)/(feed)/index': FeedRoot,
  '(tabs)/map': () => <Text>map</Text>,
};

function pillTop(testID: string): number {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style).top;
}

async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(200);
  });
}

beforeEach(() => {
  (getEngine as jest.Mock).mockReturnValue(engine);
  useTopBannerHeights.setState({ heights: {} });
});

describe('the pills on the tab roots', () => {
  it('start under the status bar, over the native header of a headered tab root', async () => {
    renderRouter(APP, { initialUrl: '/' });
    await settle();

    expect(feedHeaderHeight()).toBeGreaterThan(TOP_INSET + spacing.xs);
    expect(pillTop('sync-progress-strip')).toBe(TOP_INSET + spacing.xs);
    expect(pillTop('offline-banner')).toBe(TOP_INSET + spacing.xs);
  });

  it('start below a banner in the slot, over the header beneath it', async () => {
    renderRouter(APP, { initialUrl: '/' });
    await settle();
    await act(async () => useTopBannerHeights.getState().setHeight('syncError', 96));

    expect(pillTop('sync-progress-strip')).toBe(96 + spacing.xs);
    expect(pillTop('offline-banner')).toBe(96 + spacing.xs);
  });

  it('start at the same place on the map, which has no header', async () => {
    renderRouter(APP, { initialUrl: '/' });
    await settle();
    await act(() => router.navigate('/map'));
    await settle();

    expect(pillTop('sync-progress-strip')).toBe(TOP_INSET + spacing.xs);
    expect(pillTop('offline-banner')).toBe(TOP_INSET + spacing.xs);
  });
});
