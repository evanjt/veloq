/**
 * Scenario: a wifi-to-cellular handoff reports the internet unreachable for a
 * moment, and a real loss of the network should be said within a few seconds.
 *
 * Expected behaviour: the offline pill shows four seconds after the drop, a
 * debounce of one and a half then a hold of two and a half, and a handoff
 * shorter than that shows nothing. An online reading takes it away on the
 * render it lands. The pill floats under the status bar, so the screens keep
 * their top edge throughout. A sync-error banner gives way when the pill shows,
 * since a sync cannot progress offline, and comes back with the network.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { useAuthStore } from '@/shared/app/AuthStore';
import { NetworkProvider } from '@/shared/app/NetworkContext';
import { TopSafeAreaProvider, useTopSafeArea } from '@/shared/app/TopSafeAreaContext';
import { OfflinePill } from '@/shared/ui/StatusPills';
import { SyncErrorBanner } from '@/shared/ui/SyncErrorBanner';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
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

const DEBOUNCE_MS = 1500;
const HOLD_MS = 2500;
const ONLINE: Reading = { isConnected: true, isInternetReachable: true, type: 'WIFI' };
const UNREACHABLE: Reading = { isConnected: true, isInternetReachable: false, type: 'CELLULAR' };

/** Prints the edges the screens are handed, so the test reads them off the tree. */
function Edges() {
  const { screenEdges } = useTopSafeArea();
  return <Text testID="edges">{screenEdges.join(',')}</Text>;
}

async function mount() {
  await render(
    <NetworkProvider>
      <TopSafeAreaProvider>
        <OfflinePill />
        <SyncErrorBanner />
        <Edges />
      </TopSafeAreaProvider>
    </NetworkProvider>
  );
  await act(() => mockNetwork.listener!(ONLINE));
}

async function reading(state: Reading) {
  await act(() => mockNetwork.listener!(state));
}

async function wait(ms: number) {
  await act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/**
 * Past the debounce, then past the banner's delay. Each step is its own act,
 * as the two are separate renders on a device: one clock advance renders only
 * at its end, which would start the delay late.
 */
async function waitThroughBoth(lessMs = 0) {
  await wait(DEBOUNCE_MS);
  await wait(HOLD_MS - lessMs);
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

it('shows nothing for a handoff shorter than both waits', async () => {
  await mount();
  await reading(UNREACHABLE);

  await wait(DEBOUNCE_MS);
  await wait(HOLD_MS - 500);
  expect(screen.queryByTestId('offline-pill')).toBeNull();

  await reading(ONLINE);
  await wait(HOLD_MS * 2);
  expect(screen.queryByTestId('offline-pill')).toBeNull();
  expect(topEdgeKept()).toBe(true);
});

it('shows nothing for a drop shorter than the debounce', async () => {
  await mount();
  await reading(UNREACHABLE);
  await wait(DEBOUNCE_MS - 1);
  await reading(ONLINE);
  await wait(DEBOUNCE_MS + HOLD_MS);

  expect(screen.queryByTestId('offline-pill')).toBeNull();
});

it('shows the pill four seconds after the drop, and the screens keep their top edge', async () => {
  await mount();
  await reading(UNREACHABLE);

  await waitThroughBoth(1);
  expect(screen.queryByTestId('offline-pill')).toBeNull();

  await wait(1);
  expect(screen.getByTestId('offline-pill')).toBeTruthy();
  expect(topEdgeKept()).toBe(true);
});

it('passes touches through and wraps its words rather than cutting them', async () => {
  await mount();
  await reading(UNREACHABLE);
  await waitThroughBoth();

  expect(screen.getByTestId('offline-pill').props.pointerEvents).toBe('none');
  expect(screen.getByTestId('offline-pill-title').props.numberOfLines).toBeUndefined();
});

it('takes the pill away on the render the online reading lands', async () => {
  await mount();
  await reading(UNREACHABLE);
  await waitThroughBoth();
  expect(screen.getByTestId('offline-pill')).toBeTruthy();

  await reading(ONLINE);

  expect(screen.queryByTestId('offline-pill')).toBeNull();
});

it('starts the wait over for a second drop after coming back', async () => {
  await mount();
  await reading(UNREACHABLE);
  await waitThroughBoth();
  await reading(ONLINE);

  await reading(UNREACHABLE);
  await waitThroughBoth(1);
  expect(screen.queryByTestId('offline-pill')).toBeNull();

  await wait(1);
  expect(screen.getByTestId('offline-pill')).toBeTruthy();
});

describe('with a sync error holding the slot', () => {
  beforeEach(() => {
    mockHealth.lastError = 'HTTP 503';
  });

  it('keeps the sync-error banner and the edges through a handoff shorter than both waits', async () => {
    await mount();
    expect(screen.getByTestId('sync-error-banner')).toBeTruthy();
    expect(topEdgeKept()).toBe(false);

    await reading(UNREACHABLE);
    await wait(DEBOUNCE_MS);
    await wait(500);
    expect(screen.getByTestId('sync-error-banner')).toBeTruthy();
    expect(topEdgeKept()).toBe(false);

    await reading(ONLINE);
    expect(screen.getByTestId('sync-error-banner')).toBeTruthy();
    expect(topEdgeKept()).toBe(false);
  });

  it('gives way to the pill and hands the top edge back to the screen', async () => {
    await mount();
    await reading(UNREACHABLE);

    await waitThroughBoth(1);
    expect(screen.getByTestId('sync-error-banner')).toBeTruthy();
    expect(screen.queryByTestId('offline-pill')).toBeNull();

    await wait(1);
    expect(screen.queryByTestId('sync-error-banner')).toBeNull();
    expect(screen.getByTestId('offline-pill')).toBeTruthy();
    expect(topEdgeKept()).toBe(true);

    await reading(ONLINE);
    expect(screen.getByTestId('sync-error-banner')).toBeTruthy();
    expect(screen.queryByTestId('offline-pill')).toBeNull();
    expect(topEdgeKept()).toBe(false);
  });
});
