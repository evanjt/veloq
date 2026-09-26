/**
 * Which of the three banners claims the top slot.
 *
 * They share one inset, so the order is the whole decision: offline outranks a
 * failing sync, because a device with no network has no sync to report on, and
 * both outrank the demo ribbon.
 *
 * Offline does not depend on a session. A signed-out athlete is exactly the one
 * who cannot get back in without the network, because both login paths make a
 * round trip before they will accept a credential, so hiding the banner from
 * them withheld it from the person it was for.
 */
export interface TopBannerState {
  isOnline: boolean;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  hideDemoBanner: boolean;
  lastError: string | null;
}

export type TopBanner = 'demo' | 'offline' | 'syncError' | null;

export function pickTopBanner(state: TopBannerState): TopBanner {
  if (!state.isOnline) return 'offline';
  if (state.isAuthenticated && !state.isDemoMode && state.lastError !== null) return 'syncError';
  if (state.isDemoMode && !state.hideDemoBanner) return 'demo';
  return null;
}
