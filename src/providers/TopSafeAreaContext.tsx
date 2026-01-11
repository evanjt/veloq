/**
 * Context for managing top safe area handling when banners are present.
 *
 * The app has banners (demo, offline, cache loading) that render above the Stack navigator.
 * These banners handle their own safe area top padding. When a banner is showing,
 * screens should NOT add top safe area padding (to avoid double padding).
 *
 * This context tracks whether any banner is currently showing at the top,
 * and provides a hook for screens to get the appropriate SafeAreaView edges.
 */

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Edge } from 'react-native-safe-area-context';
import { useAuthStore } from './AuthStore';
import { useNetwork } from './NetworkContext';

interface TopSafeAreaContextValue {
  /** Whether any banner is showing at the top of the screen */
  hasTopBanner: boolean;
  /** The top safe area inset value */
  topInset: number;
  /** Which banner is showing (for determining background color) */
  activeBanner: 'demo' | 'offline' | null;
  /** The appropriate SafeAreaView edges based on banner state */
  screenEdges: Edge[];
}

const TopSafeAreaContext = createContext<TopSafeAreaContextValue | null>(null);

export function TopSafeAreaProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const hideDemoBanner = useAuthStore((s) => s.hideDemoBanner);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { isOnline } = useNetwork();

  const value = useMemo(() => {
    // Determine which banner is showing (priority order: offline > demo)
    // Note: CacheLoadingBanner is not tracked here as it has screen-specific logic
    const showOfflineBanner = isAuthenticated && !isOnline;
    const showDemoBanner = isDemoMode && !hideDemoBanner;

    let activeBanner: 'demo' | 'offline' | null = null;
    if (showOfflineBanner) {
      activeBanner = 'offline';
    } else if (showDemoBanner) {
      activeBanner = 'demo';
    }

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
    isDemoMode,
    hideDemoBanner,
    isAuthenticated,
    isOnline,
    insets.top,
  ]);

  return (
    <TopSafeAreaContext.Provider value={value}>
      {children}
    </TopSafeAreaContext.Provider>
  );
}

/**
 * Hook to access top safe area context.
 * Must be used within TopSafeAreaProvider.
 */
export function useTopSafeArea(): TopSafeAreaContextValue {
  const context = useContext(TopSafeAreaContext);
  if (!context) {
    throw new Error('useTopSafeArea must be used within a TopSafeAreaProvider');
  }
  return context;
}

/**
 * Hook to get the appropriate SafeAreaView edges for screens.
 * Excludes top edge when a banner is showing to avoid double padding.
 */
export function useScreenSafeAreaEdges(): Edge[] {
  const { screenEdges } = useTopSafeArea();
  return screenEdges;
}
