/**
 * Scenario: a top banner appears on its own, while the athlete is doing
 * something else, and a screen-reader user has no way to know it is there.
 *
 * Expected behaviour: every top banner is a live region, assertive for a
 * failure and polite otherwise, and speaks its title once on iOS when it
 * appears. Each pads the status bar by the inset the device reports and by
 * nothing else, so an Android device with no inset gets no invented floor. A
 * failing sync offers a retry that asks the engine to sync, wherever a retry
 * can succeed.
 */

import React from 'react';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, renderHook, screen } from '@testing-library/react-native';

import { useAuthStore } from '@/shared/app/AuthStore';
import { DemoBanner } from '@/shared/app/DemoBanner';
import { EngineInitBanner } from '@/shared/app/EngineInitBanner';
import { TopSafeAreaProvider, useBannerTopPadding } from '@/shared/app/TopSafeAreaContext';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { StartupErrorBanner } from '@/shared/ui/StartupErrorBanner';
import { SyncErrorBanner } from '@/shared/ui/SyncErrorBanner';
import { TrackFetchNotice } from '@/shared/ui/TrackFetchNotice';
import { SyncErrorReason } from '../__shared__/veloqrsStub';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true, offlineBannerShown: false }),
}));

let mockHealth: {
  lastError: string | null;
  lastErrorReason: SyncErrorReason | null;
  lastSuccessAt: string | null;
} = { lastError: null, lastErrorReason: null, lastSuccessAt: null };
jest.mock('@/shared/native/useSyncHealth', () => ({ useSyncHealth: () => mockHealth }));

jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));

const mockRequestSyncRefresh = requestSyncRefresh as jest.Mock;
const originalOS = Platform.OS;

function setOS(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

function failingSync(reason: SyncErrorReason) {
  mockHealth = { lastError: 'upstream said no', lastErrorReason: reason, lastSuccessAt: null };
}

function paddingTop(testID: string): number {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style).paddingTop ?? 0;
}

const BANNERS: [string, string, () => React.ReactElement, () => void][] = [
  [
    'sync-error-banner',
    'assertive',
    () => <SyncErrorBanner />,
    () => failingSync(SyncErrorReason.Server),
  ],
  [
    'track-fetch-notice',
    'polite',
    () => <TrackFetchNotice />,
    () => useTrackFetchNotice.setState({ failedIds: ['a', 'b'], failedCount: 2, dismissed: false }),
  ],
  [
    'startup-error-banner',
    'assertive',
    () => <StartupErrorBanner areas={['maps']} onRetry={() => {}} onDismiss={() => {}} />,
    () => {},
  ],
  [
    'engine-init-banner',
    'assertive',
    () => <EngineInitBanner />,
    () => useEngineStatus.setState({ initFailed: true, initFailureReason: null }),
  ],
  [
    'demo-mode-banner',
    'polite',
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <DemoBanner />
      </QueryClientProvider>
    ),
    () => useAuthStore.setState({ isDemoMode: true, hideDemoBanner: false }),
  ],
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  mockInsets.top = 0;
  mockHealth = { lastError: null, lastErrorReason: null, lastSuccessAt: null };
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false, hideDemoBanner: false });
  useTrackFetchNotice.setState({ failedIds: [], failedCount: 0, dismissed: false });
  useEngineStatus.setState({ initFailed: false, initFailureReason: null });
});

afterEach(() => {
  setOS(originalOS as 'ios' | 'android');
});

describe('a top banner reaches a screen reader', () => {
  it.each(BANNERS)('%s is a %s live region', async (testID, politeness, banner, show) => {
    show();
    await render(banner());

    expect(screen.getByTestId(testID).props.accessibilityLiveRegion).toBe(politeness);
  });

  it.each(BANNERS)(
    '%s speaks once on iOS when it appears',
    async (testID, _politeness, banner, show) => {
      setOS('ios');
      show();
      const { rerender } = await render(banner());
      await rerender(banner());

      expect(screen.getByTestId(testID)).toBeTruthy();
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    }
  );
});

describe('a top banner pads the status bar by the reported inset', () => {
  it.each(BANNERS)('%s adds no floor of its own on Android', async (testID, _p, banner, show) => {
    setOS('android');
    show();
    await render(banner());

    expect(paddingTop(testID)).toBe(0);
  });

  it.each(BANNERS)(
    '%s pads by the inset when it is the topmost',
    async (testID, _p, banner, show) => {
      mockInsets.top = 44;
      show();
      await render(banner());

      expect(paddingTop(testID)).toBe(44);
    }
  );

  it('reads no inset on Android when the device reports none', async () => {
    setOS('android');
    const { result } = await renderHook(() => useBannerTopPadding('syncError'));

    expect(result.current).toBe(0);
  });

  it('gives the inset to the banner in the slot and none to the one beneath it', async () => {
    mockInsets.top = 40;
    failingSync(SyncErrorReason.Network);
    useTrackFetchNotice.setState({ failedIds: ['a'], failedCount: 1, dismissed: false });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TopSafeAreaProvider>{children}</TopSafeAreaProvider>
    );

    const slot = await renderHook(() => useBannerTopPadding('syncError'), { wrapper });
    const beneath = await renderHook(() => useBannerTopPadding('trackFetch'), { wrapper });

    expect(slot.result.current).toBe(40);
    expect(beneath.result.current).toBe(0);
  });
});

describe('a failing sync offers a way back', () => {
  it.each([SyncErrorReason.Network, SyncErrorReason.Server, SyncErrorReason.RateLimited])(
    'asks the engine to sync again for reason %s',
    async (reason) => {
      failingSync(reason);
      await render(<SyncErrorBanner />);

      await fireEvent.press(screen.getByTestId('sync-error-banner-retry'));

      expect(mockRequestSyncRefresh).toHaveBeenCalledTimes(1);
    }
  );

  it.each([SyncErrorReason.Unauthorized, SyncErrorReason.NotConfigured])(
    'offers no retry that cannot succeed for reason %s',
    async (reason) => {
      failingSync(reason);
      await render(<SyncErrorBanner />);

      expect(screen.queryByTestId('sync-error-banner-retry')).toBeNull();
    }
  );
});

describe('the startup error closes like every other banner', () => {
  it('dismisses through the shared close control', async () => {
    const onDismiss = jest.fn();
    await render(<StartupErrorBanner areas={['maps']} onRetry={() => {}} onDismiss={onDismiss} />);

    await fireEvent.press(screen.getByTestId('startup-error-banner-dismiss'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('common.close')).toBeTruthy();
  });
});
