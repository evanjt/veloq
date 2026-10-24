// Banners render above the Stack and the topmost owns the top safe-area padding. When a banner shows, screens must exclude the top edge to avoid
// double padding. This context tracks banner state and exposes the right edges.

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Edge, EdgeInsets } from 'react-native-safe-area-context';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncHealth } from '@/shared/native/useSyncHealth';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { spacing } from '@/theme';
import {
  pickTopBanner,
  padsStatusBar,
  stackHeight,
  useTopBannerHeights,
  type ShownBanner,
  type TopBanner,
} from './topBanner';

import { useNetwork } from './NetworkContext';
import { stackHeaderOptions, type SheetWindow } from './screenHeaders';
import { useTheme } from './useTheme';

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
  const { lastError, retryAtMs } = useSyncHealth();
  const syncPaused = (retryAtMs ?? null) !== null;
  const engineInitFailed = useEngineStatus((s) => s.initFailed);
  const value = useMemo(() => {
    const activeBanner = pickTopBanner({
      startupErrorShown,
      offlineBannerShown,
      isAuthenticated,
      isDemoMode,
      hideDemoBanner,
      lastError: lastError ?? null,
      syncPaused,
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
    syncPaused,
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
 * Where each status pill in the floating stack starts, given the pills' drawn
 * heights from the top down: the first below every banner in the top slot, so it
 * never covers one, or under the inset when the slot is empty, and each after it
 * below the one above. The stack floats over the header a screen draws rather
 * than below it, and passes touches through, so the header's buttons stay
 * pressable beneath it.
 */
export function useFloatingPillTops(heights: readonly number[]): number[] {
  const insets = useSafeAreaInsets();
  const slot = useTopBannerHeights((s) => stackHeight(s.heights));
  return pillStack(insets.top, slot, heights);
}

/** The first pill's top from the status-bar inset and the banner slot's height. */
export function floatingPillTop(inset: number, slot: number): number {
  return Math.max(inset, slot) + spacing.xs;
}

/**
 * One top per pill, `spacing.xs` apart, each starting below the whole height of
 * the pill above it, so no two pills overlap however tall their text wraps.
 */
export function pillStack(inset: number, slot: number, heights: readonly number[]): number[] {
  const tops: number[] = [];
  let next = floatingPillTop(inset, slot);
  for (const height of heights) {
    tops.push(next);
    next += height + spacing.xs;
  }
  return tops;
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

/**
 * The stack header options for the stack's place in the tree: beneath a filled top slot the
 * native header does not pad the status bar a second time. Outside a provider the slot is empty.
 */
export function useStackHeaderOptions() {
  const hasTopBanner = useContext(TopSafeAreaContext)?.hasTopBanner ?? false;
  const { isDark } = useTheme();
  return useMemo(
    () => stackHeaderOptions(Platform.OS, isDark, hasTopBanner),
    [isDark, hasTopBanner]
  );
}

/** The device's insets, wherever in the tree it is read, for a view laid out against the window. */
export function useWindowInsets(): EdgeInsets {
  const local = useSafeAreaInsets();
  return useContext(WindowInsetsContext) ?? local;
}

/**
 * The window a map sheet is laid out against, with the device's insets. The system sizes the
 * sheet against the window and the status bar whatever the top slot holds, so the stack's own
 * insets, which drop the top beneath a banner, would give the sheet detents for a taller sheet
 * than the system allows.
 */
export function useSheetWindow(): SheetWindow {
  const { width, height } = useWindowDimensions();
  const { top, bottom } = useWindowInsets();
  return useMemo(
    () => ({ width, height, topInset: top, bottomInset: bottom }),
    [width, height, top, bottom]
  );
}

/** Gives its subtree the device's insets, for a view that covers the whole window. */
export function WindowInsets({ children }: { children: ReactNode }) {
  const device = useWindowInsets();
  return <SafeAreaInsetsContext.Provider value={device}>{children}</SafeAreaInsetsContext.Provider>;
}
