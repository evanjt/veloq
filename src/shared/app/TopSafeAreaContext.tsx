// Banners (demo, offline, cache loading) render above the Stack and own their top
// safe-area padding. When a banner shows, screens must exclude the top edge to avoid
// double padding. This context tracks banner state and exposes the right edges.

import React, { createContext, useContext, useMemo, useState, useCallback, ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Edge } from 'react-native-safe-area-context';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useNetwork } from './NetworkContext';

interface TopSafeAreaContextValue {
  hasTopBanner: boolean;
  topInset: number;
  activeBanner: 'demo' | 'offline' | null;
  screenEdges: Edge[];
  setSyncBannerVisible: (visible: boolean) => void;
}

const TopSafeAreaContext = createContext<TopSafeAreaContextValue | null>(null);

export function TopSafeAreaProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const hideDemoBanner = useAuthStore((s) => s.hideDemoBanner);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { isOnline } = useNetwork();
  const [syncBannerVisible, setSyncBannerVisibleState] = useState(false);

  const setSyncBannerVisible = useCallback((visible: boolean) => {
    setSyncBannerVisibleState(visible);
  }, []);

  const value = useMemo(() => {
    // Determine which banner is showing (priority order: offline > demo > sync)
    const showOfflineBanner = isAuthenticated && !isOnline;
    const showDemoBanner = isDemoMode && !hideDemoBanner;

    let activeBanner: 'demo' | 'offline' | null = null;
    if (showOfflineBanner) {
      activeBanner = 'offline';
    } else if (showDemoBanner) {
      activeBanner = 'demo';
    }

    // Sync banner is now an overlay — doesn't affect layout or safe area
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
      setSyncBannerVisible,
    };
  }, [isDemoMode, hideDemoBanner, isAuthenticated, isOnline, insets.top, setSyncBannerVisible]);

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

export function useScreenSafeAreaEdges(): Edge[] {
  const { screenEdges } = useTopSafeArea();
  return screenEdges;
}
