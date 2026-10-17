/**
 * Which of the top banners claims the top slot.
 *
 * They stack under one status bar, so the topmost carries the inset and the
 * rest sit flush beneath it. The order is the whole decision: a failing sync
 * outranks the notices and the demo ribbon. The order matches the order the
 * banners mount in, so the one picked here is the one drawn first.
 *
 * Offline is not in the slot. It is a pill floating under the status bar, which
 * moves no screen's edge, so it takes no inset. It still outranks a failing
 * sync, because a device with no network has no sync to report on: the
 * sync-error banner gives way while the pill shows, and the slot with it.
 */

import { create } from 'zustand';

export interface TopBannerState {
  startupErrorShown: boolean;
  /**
   * The provider's held value rather than `isOnline`: a sync-error banner keeps
   * the slot through the offline pill's hold and gives it up when the pill
   * shows, rather than vanishing while the hold runs.
   */
  offlineBannerShown: boolean;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  hideDemoBanner: boolean;
  lastError: string | null;
  trackFetchNoticeShown: boolean;
  engineInitFailed: boolean;
}

export type TopBanner = 'startupError' | 'demo' | 'syncError' | 'trackFetch' | 'engineInit' | null;

export type ShownBanner = Exclude<TopBanner, null>;

/** Whether a banner carries the status-bar inset: the topmost does, and so does a banner with no slot owner above it. */
export function padsStatusBar(active: TopBanner | undefined, self: ShownBanner): boolean {
  return active == null || active === self;
}

export function pickTopBanner(state: TopBannerState): TopBanner {
  if (state.startupErrorShown) return 'startupError';
  if (
    state.isAuthenticated &&
    !state.isDemoMode &&
    !state.offlineBannerShown &&
    state.lastError !== null
  ) {
    return 'syncError';
  }
  if (state.trackFetchNoticeShown) return 'trackFetch';
  if (state.engineInitFailed) return 'engineInit';
  if (state.isDemoMode && !state.hideDemoBanner) return 'demo';
  return null;
}

interface TopBannerHeights {
  /** Each shown banner's drawn height, its status-bar padding included. */
  heights: Partial<Record<ShownBanner, number>>;
  /** Records a banner's height as it lays out, and drops it with `null` as it goes. */
  setHeight(banner: ShownBanner, height: number | null): void;
}

/**
 * How tall the banners in the top slot are drawn.
 *
 * The floating pills sit below the slot rather than over it, and only layout
 * knows how tall a banner came out, since its lines wrap with the text size.
 */
export const useTopBannerHeights = create<TopBannerHeights>((set) => ({
  heights: {},
  setHeight: (banner, height) =>
    set((state) => {
      if ((state.heights[banner] ?? null) === height) return state;
      const heights = { ...state.heights };
      if (height === null) delete heights[banner];
      else heights[banner] = height;
      return { heights };
    }),
}));

/** The banners stack, so the slot ends at the sum of their heights. */
export function stackHeight(heights: Partial<Record<ShownBanner, number>>): number {
  return Object.values(heights).reduce((sum, height) => sum + (height ?? 0), 0);
}
