/**
 * Which of the top banners claims the top slot.
 *
 * They stack under one status bar, so the topmost carries the inset and the
 * rest sit flush beneath it. The order is the whole decision: offline outranks
 * a failing sync, because a device with no network has no sync to report on,
 * and both outrank the notices and the demo ribbon. The order matches the order
 * the banners mount in, so the one picked here is the one drawn first.
 *
 * Offline does not depend on a session. A signed-out athlete is exactly the one
 * who cannot get back in without the network, because both login paths make a
 * round trip before they will accept a credential, so hiding the banner from
 * them withheld it from the person it was for.
 */
export interface TopBannerState {
  startupErrorShown: boolean;
  /**
   * The provider's held value rather than `isOnline`, so the inset moves with
   * the offline banner and not ahead of it. The sync-error arm reads it too: a
   * sync-error banner keeps the slot through the hold and hands it straight to
   * the offline banner, rather than leaving the slot empty while the hold runs.
   */
  offlineBannerShown: boolean;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  hideDemoBanner: boolean;
  lastError: string | null;
  trackFetchNoticeShown: boolean;
  engineInitFailed: boolean;
}

export type TopBanner =
  | 'startupError'
  | 'demo'
  | 'offline'
  | 'syncError'
  | 'trackFetch'
  | 'engineInit'
  | null;

type ShownBanner = Exclude<TopBanner, null>;

/** Whether a banner carries the status-bar inset: the topmost does, and so does a banner with no slot owner above it. */
export function padsStatusBar(active: TopBanner | undefined, self: ShownBanner): boolean {
  return active == null || active === self;
}

export function pickTopBanner(state: TopBannerState): TopBanner {
  if (state.startupErrorShown) return 'startupError';
  if (state.offlineBannerShown) return 'offline';
  if (state.isAuthenticated && !state.isDemoMode && state.lastError !== null) {
    return 'syncError';
  }
  if (state.trackFetchNoticeShown) return 'trackFetch';
  if (state.engineInitFailed) return 'engineInit';
  if (state.isDemoMode && !state.hideDemoBanner) return 'demo';
  return null;
}
