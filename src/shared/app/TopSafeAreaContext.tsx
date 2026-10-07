// Banners render above the Stack and the topmost owns the top safe-area padding. When a banner shows, screens must exclude the top edge to avoid
// double padding. This context tracks banner state and exposes the right edges.

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Edge } from 'react-native-safe-area-context';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncHealth } from '@/shared/native/useSyncHealth';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { pickTopBanner, padsStatusBar, type TopBanner } from './topBanner';

import { useNetwork } from './NetworkContext';

interface TopSafeAreaContextValue {
  hasTopBanner: boolean;
  topInset: number;
  activeBanner: TopBanner;
  screenEdges: Edge[];
}

const TopSafeAreaContext = createContext<TopSafeAreaContextValue | null>(null);

export function TopSafeAreaProvider({
  children,
  startupErrorShown = false,
}: {
  children: ReactNode;
  startupErrorShown?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const hideDemoBanner = useAuthStore((s) => s.hideDemoBanner);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { offlineBannerShown } = useNetwork();
  const { lastError } = useSyncHealth();
  const trackFetchNoticeShown = useTrackFetchNotice((s) => s.failedCount > 0 && !s.dismissed);
  const engineInitFailed = useEngineStatus((s) => s.initFailed);
  const value = useMemo(() => {
    const activeBanner = pickTopBanner({
      startupErrorShown,
      offlineBannerShown,
      isAuthenticated,
      isDemoMode,
      hideDemoBanner,
      lastError: lastError ?? null,
      trackFetchNoticeShown,
      engineInitFailed,
    });

    // Sync banner is now an overlay - doesn't affect layout or safe area
    const hasTopBanner = activeBanner !== null;

    // When a banner is showing, screens should exclude top edge
    const screenEdges: Edge[] = hasTopBanner
      ? ['bottom', 'left', 'right']
      : ['top', 'bottom', 'left', 'right'];

    return {
      hasTopBanner,
      topInset: insets.top,
      activeBanner,
      screenEdges,
    };
  }, [
    startupErrorShown,
    isDemoMode,
    hideDemoBanner,
    isAuthenticated,
    offlineBannerShown,
    lastError,
    trackFetchNoticeShown,
    engineInitFailed,
    insets.top,
  ]);

  // Banner animations are handled by Reanimated SlideInUp/SlideOutUp on each banner component
  return <TopSafeAreaContext.Provider value={value}>{children}</TopSafeAreaContext.Provider>;
}

export function useTopSafeArea(): TopSafeAreaContextValue {
  const context = useContext(TopSafeAreaContext);
  if (!context) {
    throw new Error('useTopSafeArea must be used within a TopSafeAreaProvider');
  }
  return context;
}

/**
 * Whether this banner carries the status-bar inset. Outside a provider, as in
 * a standalone render, it does.
 */
export function useBannerPadsStatusBar(self: Exclude<TopBanner, null>): boolean {
  const context = useContext(TopSafeAreaContext);
  return padsStatusBar(context?.activeBanner, self);
}

export function useScreenSafeAreaEdges(): Edge[] {
  const { screenEdges } = useTopSafeArea();
  return screenEdges;
}
