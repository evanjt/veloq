/**
 * Scenario: banners stack under one status bar, and a demo session can lose the
 * network while they do.
 *
 * Expected behaviour: the topmost banner carries the status-bar inset and the
 * one beneath it sits flush, so no blank band opens between them. The offline
 * pill floats rather than stacking, so it takes no part in the inset.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';

import { useAuthStore } from '@/shared/app/AuthStore';
import { TopSafeAreaProvider } from '@/shared/app/TopSafeAreaContext';
import { DemoBanner } from '@/shared/app/DemoBanner';
import { OfflineBanner } from '@/shared/ui/OfflineBanner';
import { TrackFetchNotice } from '@/shared/ui/TrackFetchNotice';
import { StartupErrorBanner } from '@/shared/ui/StartupErrorBanner';
import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { spacing } from '@/theme';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/shared/app/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

let mockOffline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: !mockOffline, offlineBannerShown: mockOffline }),
}));

jest.mock('@/shared/native/useSyncHealth', () => ({
  useSyncHealth: () => ({ lastError: null, lastErrorReason: null, lastSuccessAt: null }),
}));

function paddingTop(node: { props: { style?: unknown } }): number {
  return (StyleSheet.flatten(node.props.style as object) as { paddingTop: number }).paddingTop;
}

describe('top banner stack', () => {
  beforeEach(() => {
    mockOffline = true;
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: true, hideDemoBanner: false });
    useTrackFetchNotice.setState({ failedIds: [], failedCount: 0, dismissed: false });
  });

  it('pads the startup error with the offline pill floating beside it', async () => {
    const { getByTestId } = await render(
      <TopSafeAreaProvider startupErrorShown>
        <StartupErrorBanner areas={['preferences']} onDismiss={() => {}} />
        <OfflineBanner />
      </TopSafeAreaProvider>
    );

    expect(paddingTop(getByTestId('startup-error-banner'))).toBe(40);
    expect(
      (
        StyleSheet.flatten(getByTestId('startup-error-banner-content').props.style) as {
          paddingVertical: number;
        }
      ).paddingVertical
    ).toBe(spacing.sm);
    expect(getByTestId('offline-banner')).toBeTruthy();
  });

  it('pads the demo banner for the status bar while the offline pill floats over it', async () => {
    const { getByTestId } = await render(
      <QueryClientProvider client={new QueryClient()}>
        <TopSafeAreaProvider>
          <OfflineBanner />
          <DemoBanner />
        </TopSafeAreaProvider>
      </QueryClientProvider>
    );

    expect(getByTestId('offline-banner')).toBeTruthy();
    expect(paddingTop(getByTestId('demo-mode-banner'))).toBe(40);
  });

  it('pads the track notice when it is the only banner', async () => {
    mockOffline = false;
    useAuthStore.setState({ isDemoMode: false });
    useTrackFetchNotice.setState({ failedIds: ['a', 'b', 'c'], failedCount: 3, dismissed: false });
    const { getByTestId } = await render(
      <TopSafeAreaProvider>
        <TrackFetchNotice />
      </TopSafeAreaProvider>
    );

    expect(paddingTop(getByTestId('track-fetch-notice'))).toBe(40);
  });
});
