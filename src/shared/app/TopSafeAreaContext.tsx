// Banners render above the Stack and the topmost owns the top safe-area padding. When a banner shows, screens must exclude the top edge to avoid
// double padding. This context tracks banner state and exposes the right edges.

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Edge, EdgeInsets } from 'react-native-safe-area-context';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncHealth } from '@/shared/native/useSyncHealth';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { spacing } from '@/theme';
import {
  pickTopBanner,
  padsStatusBar,
  shownHeaderHeight,
  stackHeight,
  useShownHeaderHeights,
  useTopBannerHeights,
  type ShownBanner,
  type TopBanner,
} from './topBanner';

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
export function useBannerPadsStatusBar(self: ShownBanner): boolean {
  const context = useContext(TopSafeAreaContext);
  return padsStatusBar(context?.activeBanner, self);
}

/**
 * The top padding a banner in the slot draws: the inset the device reports
 * when it is the topmost, and none beneath it. The safe-area context already
 * reports the real inset under edge-to-edge, so there is no floor per platform,
 * and a banner keeps its own inner spacing in its own style.
 */
export function useBannerTopPadding(self: ShownBanner): number {
  const insets = useSafeAreaInsets();
  return useBannerPadsStatusBar(self) ? insets.top : 0;
}

/**
 * Where a pill floating under the status bar starts: below every banner in the
 * top slot, so it never covers one, and under the inset when the slot is empty.
 * The stack sits beneath the slot, so on a screen whose native header is shown
 * the pill starts below that header's bottom edge instead, never over its title.
 */
export function useFloatingPillTop(): number {
  const insets = useSafeAreaInsets();
  const slot = useTopBannerHeights((s) => stackHeight(s.heights));
  const header = useShownHeaderHeights((s) => shownHeaderHeight(s.heights));
  return floatingPillTop(insets.top, slot, header);
}

/** The pill's top from the status-bar inset, the banner slot's height and the shown header's. */
function floatingPillTop(inset: number, slot: number, header: number): number {
  if (header > 0) return slot + header + spacing.xs;
  return Math.max(inset, slot) + spacing.xs;
}

export function useScreenSafeAreaEdges(): Edge[] {
  const { screenEdges } = useTopSafeArea();
  return screenEdges;
}

/** The device's own insets, which a view covering the whole window clears, set beneath the slot. */
const WindowInsetsContext = createContext<EdgeInsets | null>(null);

/**
 * The insets the stack is laid out in. A banner in the top slot pads the status bar and pushes
 * the stack down beneath it, so beneath a filled slot the status bar is already cleared and the
 * stack sees no top inset: every native header starts flush under the banner and no screen pads
 * the status bar a second time. A view that covers the whole window, as a modal does, reads the
 * device's insets back through `WindowInsets`.
 */
export function BeneathTopSlot({ children }: { children: ReactNode }) {
  const { hasTopBanner } = useTopSafeArea();
  const device = useSafeAreaInsets();
  const beneath = useMemo(
    () => (hasTopBanner ? { ...device, top: 0 } : device),
    [hasTopBanner, device]
  );
  return (
    <WindowInsetsContext.Provider value={device}>
      <SafeAreaInsetsContext.Provider value={beneath}>{children}</SafeAreaInsetsContext.Provider>
    </WindowInsetsContext.Provider>
  );
}

/** The device's insets, wherever in the tree it is read, for a view laid out against the window. */
export function useWindowInsets(): EdgeInsets {
  const local = useSafeAreaInsets();
  return useContext(WindowInsetsContext) ?? local;
}

/** Gives its subtree the device's insets, for a view that covers the whole window. */
export function WindowInsets({ children }: { children: ReactNode }) {
  const device = useWindowInsets();
  return <SafeAreaInsetsContext.Provider value={device}>{children}</SafeAreaInsetsContext.Provider>;
}
