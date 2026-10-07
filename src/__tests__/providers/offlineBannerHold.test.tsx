/**
 * Scenario: a wifi-to-cellular handoff reports the internet unreachable for a
 * few seconds, longer than the three-second offline debounce. The banner slid
 * in, the screens gave up their top edge, and half a second later both moved
 * back.
 *
 * Expected behaviour: the banner and the top edge wait a further five seconds
 * past the debounce, and move together. An online reading takes both back on
 * the same render. A sync-error banner already up keeps the slot through the
 * same wait and hands it straight to the offline banner.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { useAuthStore } from '@/shared/app/AuthStore';
import { NetworkProvider, OFFLINE_BANNER_DELAY_MS } from '@/shared/app/NetworkContext';
import { TopSafeAreaProvider, useTopSafeArea } from '@/shared/app/TopSafeAreaContext';
import { OfflineBanner } from '@/shared/ui/OfflineBanner';
import { SyncErrorBanner } from '@/shared/ui/SyncErrorBanner';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ setNetworkOnline: () => {} }),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));

const mockHealth: { lastError: string | null } = { lastError: null };
jest.mock('@/shared/native/useSyncHealth', () => ({
  useSyncHealth: () => ({
    lastError: mockHealth.lastError,
    lastErrorReason: null,
    lastSuccessAt: null,
  }),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

type Reading = { isConnected: boolean; isInternetReachable: boolean; type: string };
const mockNetwork: { listener: ((s: Reading) => void) | null } = { listener: null };

jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  addNetworkStateListener: (listener: (s: Reading) => void) => {
    mockNetwork.listener = listener;
    return { remove: () => {} };
  },
  getNetworkStateAsync: () => new Promise(() => {}),
}));

const DEBOUNCE_MS = 3000;
const ONLINE: Reading = { isConnected: true, isInternetReachable: true, type: 'WIFI' };
const UNREACHABLE: Reading = { isConnected: true, isInternetReachable: false, type: 'CELLULAR' };

/** Prints the edges the screens are handed, so the test reads them off the tree. */
function Edges() {
  const { screenEdges } = useTopSafeArea();
  return <Text testID="edges">{screenEdges.join(',')}</Text>;
}

function mount() {
  render(
    <NetworkProvider>
      <TopSafeAreaProvider>
        <OfflineBanner />
        <SyncErrorBanner />
        <Edges />
      </TopSafeAreaProvider>
    </NetworkProvider>
  );
  act(() => mockNetwork.listener!(ONLINE));
}

function reading(state: Reading) {
  act(() => mockNetwork.listener!(state));
}

function wait(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/**
 * Past the debounce, then past the banner's delay. Each step is its own act,
 * as the two are separate renders on a device: one clock advance renders only
 * at its end, which would start the delay late.
 */
function waitThroughBoth(lessMs = 0) {
  wait(DEBOUNCE_MS);
  wait(OFFLINE_BANNER_DELAY_MS - lessMs);
}

function topEdgeKept(): boolean {
  return screen.getByTestId('edges').props.children.split(',').includes('top');
}

beforeEach(() => {
  jest.useFakeTimers();
  mockNetwork.listener = null;
  mockHealth.lastError = null;
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false, hideDemoBanner: false });
});

afterEach(() => {
  jest.useRealTimers();
});

it('shows neither the banner nor a moved edge for a handoff shorter than both waits', () => {
  mount();
  reading(UNREACHABLE);

  wait(DEBOUNCE_MS);
  wait(500);
  expect(screen.queryByTestId('offline-banner')).toBeNull();
  expect(topEdgeKept()).toBe(true);

  wait(OFFLINE_BANNER_DELAY_MS - 1000);
  expect(screen.queryByTestId('offline-banner')).toBeNull();
  expect(topEdgeKept()).toBe(true);

  reading(ONLINE);
  wait(OFFLINE_BANNER_DELAY_MS * 2);
  expect(screen.queryByTestId('offline-banner')).toBeNull();
  expect(topEdgeKept()).toBe(true);
});

it('shows the banner and hands over the top edge together once the spell outlasts both', () => {
  mount();
  reading(UNREACHABLE);

  waitThroughBoth(1);
  expect(screen.queryByTestId('offline-banner')).toBeNull();
  expect(topEdgeKept()).toBe(true);

  wait(1);
  expect(screen.getByTestId('offline-banner')).toBeTruthy();
  expect(topEdgeKept()).toBe(false);
});

it('takes the banner and the edge back on the render the online reading lands', () => {
  mount();
  reading(UNREACHABLE);
  waitThroughBoth();
  expect(screen.getByTestId('offline-banner')).toBeTruthy();

  reading(ONLINE);

  expect(screen.queryByTestId('offline-banner')).toBeNull();
  expect(topEdgeKept()).toBe(true);
});

it('starts the wait over for a second drop after coming back', () => {
  mount();
  reading(UNREACHABLE);
  waitThroughBoth();
  reading(ONLINE);

  reading(UNREACHABLE);
  waitThroughBoth(1);
  expect(screen.queryByTestId('offline-banner')).toBeNull();
  expect(topEdgeKept()).toBe(true);

  wait(1);
  expect(screen.getByTestId('offline-banner')).toBeTruthy();
});

describe('with a sync error holding the slot', () => {
  beforeEach(() => {
    mockHealth.lastError = 'HTTP 503';
  });

  it('keeps the sync-error banner and the edges through a handoff shorter than both waits', () => {
    mount();
    expect(screen.getByTestId('sync-error-banner')).toBeTruthy();
    expect(topEdgeKept()).toBe(false);

    reading(UNREACHABLE);
    wait(DEBOUNCE_MS);
    wait(500);
    expect(screen.getByTestId('sync-error-banner')).toBeTruthy();
    expect(topEdgeKept()).toBe(false);

    reading(ONLINE);
    expect(screen.getByTestId('sync-error-banner')).toBeTruthy();
    expect(topEdgeKept()).toBe(false);
  });

  it('swaps the sync-error banner for the offline one on the same render', () => {
    mount();
    reading(UNREACHABLE);

    waitThroughBoth(1);
    expect(screen.getByTestId('sync-error-banner')).toBeTruthy();
    expect(screen.queryByTestId('offline-banner')).toBeNull();

    wait(1);
    expect(screen.queryByTestId('sync-error-banner')).toBeNull();
    expect(screen.getByTestId('offline-banner')).toBeTruthy();
    expect(topEdgeKept()).toBe(false);

    reading(ONLINE);
    expect(screen.getByTestId('sync-error-banner')).toBeTruthy();
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    expect(topEdgeKept()).toBe(false);
  });
});
